import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, mkdir, open, realpath, unlink } from "node:fs/promises";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import { join, resolve } from "node:path";

export const MAX_IMAGE_BYTES = 4_000_000;

const MAX_CLASSIFIER_BYTES = 500_000;
// TypeSafe rejects either side below 280 pixels, even when the area is sufficient.
const MIN_IMAGE_DIMENSION = 280;
const MAX_IMAGE_DIMENSION = 1_568;
const MIN_IMAGE_AREA = 78_400;
const MAX_IMAGE_AREA = 2_458_624;
const MAX_DECODE_AREA = 8_000_000;
export class ImageProcessorUnavailableError extends Error {}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

const IMAGE_MIME = ["image/png", "image/jpeg"] as const;
export type ImageMime = (typeof IMAGE_MIME)[number];

type ImageInput = { data: string; mimeType: string };

const hasUid = typeof process.getuid === "function";
const currentUid = typeof process.getuid === "function" ? process.getuid() : undefined;
const dirFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileReadFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const fileWriteFlags =
  constants.O_WRONLY |
  constants.O_CREAT |
  constants.O_EXCL |
  constants.O_NOFOLLOW |
  constants.O_NONBLOCK;
const childEnv = {
  PATH: "/usr/bin:/bin",
  HOME: "/nonexistent",
  LANG: "C",
  LC_ALL: "C",
};

function fail(message: string): never {
  throw new Error(message);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function imageMime(value: string): ImageMime {
  if (value !== "image/png" && value !== "image/jpeg") fail("Unsupported image MIME type");
  return value;
}

function assertOwner(uid: number, what: string): void {
  if (hasUid && uid !== currentUid) fail(`${what} has an unexpected owner`);
}

function assertPrivateMode(mode: number, what: string): void {
  if ((mode & 0o077) !== 0) fail(`${what} is not owner-only`);
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeBase64(data: unknown): Buffer {
  if (
    typeof data !== "string" ||
    data.length === 0 ||
    data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(data)
  )
    fail("Invalid image base64");
  const bytes = Buffer.from(data, "base64");
  if (
    bytes.length === 0 ||
    bytes.length > MAX_IMAGE_BYTES ||
    bytes.toString("base64") !== data
  )
    fail("Invalid image base64");
  return bytes;
}

function assertMagic(bytes: Buffer, mimeType: ImageMime): void {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mimeType === "image/png" && !bytes.subarray(0, png.length).equals(png))
    fail("Image MIME type does not match its contents");
  if (
    mimeType === "image/jpeg" &&
    !(bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
  )
    fail("Image MIME type does not match its contents");
}

function abortError(): Error {
  return Object.assign(new Error("Image processing was aborted"), { name: "AbortError" });
}

export function checkImageProcessingAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export function runImageProcessor(
  operation: "inspect" | "normalize",
  input: Buffer,
  mimeType: ImageMime,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Buffer> {
  const { signal, timeoutMs = 15_000 } = options;
  checkImageProcessingAbort(signal);
  if (!input.length || input.length > MAX_IMAGE_BYTES) fail("Image input exceeded its byte limit");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail("Invalid image processing timeout");
  const maxOutputBytes = operation === "inspect" ? 0 : MAX_CLASSIFIER_BYTES;
  const request = JSON.stringify({ operation, mimeType, limits: {
    maxImageBytes: MAX_IMAGE_BYTES, maxDecodeArea: MAX_DECODE_AREA,
    minDimension: MIN_IMAGE_DIMENSION, maxDimension: MAX_IMAGE_DIMENSION,
    minArea: MIN_IMAGE_AREA, maxArea: MAX_IMAGE_AREA, maxClassifierBytes: MAX_CLASSIFIER_BYTES,
  } });
  return new Promise((resolvePromise, rejectPromise) => {
    let child: ChildProcessByStdio<Writable, Readable, Readable>;
    try {
      child = spawn(process.execPath, [join(__dirname, "image-codec.cjs"), request], {
        cwd: "/", env: childEnv, shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      });
    } catch {
      rejectPromise(new ImageProcessorUnavailableError("Sharp image processor could not be started"));
      return;
    }
    let outputBytes = 0;
    let failure: Error | undefined;
    let errorBytes = Buffer.alloc(0);
    const chunks: Buffer[] = [];
    const stop = (error: Error) => {
      if (failure !== undefined) return;
      failure = error;
      child.kill("SIGKILL");
    };
    const onAbort = () => stop(abortError());
    // A process deadline can terminate native work, unlike a raced Promise or worker-thread abort.
    const timeout = setTimeout(() => stop(new Error("Image processing timed out")), timeoutMs);
    timeout.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stdout.on("data", (part: Buffer) => {
      if (failure !== undefined) return;
      outputBytes += part.length;
      if (outputBytes > maxOutputBytes) {
        stop(new Error("Image processor output exceeded its limit"));
        return;
      }
      chunks.push(part);
    });
    child.stderr.on("data", (part: Buffer) => {
      if (errorBytes.length < 1_024)
        errorBytes = Buffer.concat([errorBytes, part.subarray(0, 1_024 - errorBytes.length)]);
    });
    child.stdin.on("error", () => {});
    child.on("error", () => stop(new ImageProcessorUnavailableError("Sharp image processor could not be started")));
    child.on("close", (code: number | null) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (failure !== undefined) rejectPromise(failure);
      else if (code === 2) rejectPromise(new ImageProcessorUnavailableError("Sharp image processor is unavailable"));
      else if (code !== 0) rejectPromise(new Error(errorBytes.toString("utf8").replace(/\p{Cc}/gu, " ").trim() || "Sharp rejected the image"));
      else if (signal?.aborted) rejectPromise(abortError());
      else resolvePromise(Buffer.concat(chunks, outputBytes));
    });
    child.stdin.end(input);
  });
}

export async function validateImageInput(image: ImageInput): Promise<{ bytes: Buffer; mimeType: ImageMime }> {
  const mimeType = imageMime(image?.mimeType ?? "");
  const bytes = decodeBase64(image?.data);
  assertMagic(bytes, mimeType);
  await runImageProcessor("inspect", bytes, mimeType);
  return { bytes, mimeType };
}

export async function normalizeImageForClassifier(bytes: Buffer, mimeType: string, signal?: AbortSignal): Promise<Buffer> {
  const mime = imageMime(mimeType);
  assertMagic(bytes, mime);
  const output = await runImageProcessor("normalize", bytes, mime, signal ? { signal } : {});
  assertMagic(output, mime);
  return output;
}

async function openSessionDirectory(root: string, sessionId: string, create: boolean) {
  if (!validId(sessionId)) fail("Invalid image session ID");
  const rootPath = resolve(root);
  if (create) await mkdir(rootPath, { recursive: true, mode: 0o700 });
  const canonicalRoot = await realpath(rootPath);
  const rootHandle = await open(canonicalRoot, dirFlags);
  // Keep the canonical root descriptor open until the child session descriptor is pinned.
  const sessionPath = join(canonicalRoot, sessionId);
  const rootOperationPath =
    process.platform === "linux" ? `/proc/self/fd/${rootHandle.fd}` : canonicalRoot;
  try {
    const rootStat = await rootHandle.stat();
    if (!rootStat.isDirectory()) fail("Image archive root is not a directory");
    assertOwner(rootStat.uid, "Image archive root");
    if (create) await rootHandle.chmod(0o700);
    else assertPrivateMode(rootStat.mode, "Image archive root");

    const sessionOperationPath = join(rootOperationPath, sessionId);
    if (create) {
      try {
        await mkdir(sessionOperationPath, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    const handle = await open(sessionOperationPath, dirFlags | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isDirectory()) fail("Image session archive is not a directory");
      assertOwner(stat.uid, "Image session archive");
      const canonicalSession = await realpath(sessionOperationPath);
      if (canonicalSession !== sessionPath) fail("Image session archive escaped its root");
      if (create) await handle.chmod(0o700);
      else assertPrivateMode(stat.mode, "Image session archive");
      const operationPath =
        process.platform === "linux" ? `/proc/self/fd/${handle.fd}` : sessionPath;
      return { canonicalRoot, sessionPath, handle, operationPath };
    } catch (error) {
      await handle.close();
      throw error;
    }
  } finally {
    await rootHandle.close();
  }
}

async function readFileExactly(
  path: string,
  expectedBytes: number,
  expectedHash: string,
): Promise<Buffer> {
  const handle = await open(path, fileReadFlags);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) fail("Archived image is not a regular file");
    if (stat.nlink !== 1) fail("Archived image has unexpected hard links");
    assertOwner(stat.uid, "Archived image");
    assertPrivateMode(stat.mode, "Archived image");
    if (stat.size !== expectedBytes || stat.size < 1 || stat.size > MAX_IMAGE_BYTES)
      fail("Archived image size does not match its record");
    const bytes = Buffer.alloc(expectedBytes);
    let offset = 0;
    while (offset < expectedBytes) {
      const result = await handle.read(bytes, offset, expectedBytes - offset, offset);
      if (result.bytesRead === 0) fail("Archived image ended unexpectedly");
      offset += result.bytesRead;
    }
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, expectedBytes)).bytesRead !== 0)
      fail("Archived image changed while being read");
    const finalStat = await handle.stat();
    if (finalStat.size !== expectedBytes || digest(bytes) !== expectedHash)
      fail("Archived image digest does not match its record");
    return bytes;
  } finally {
    await handle.close();
  }
}

export async function readImageBytes(
  root: string,
  sessionId: string,
  fileName: string,
  expectedBytes: number,
  expectedHash: string,
  mimeType: ImageMime,
): Promise<Buffer> {
  const archive = await openSessionDirectory(root, sessionId, false);
  try {
    const bytes = await readFileExactly(
      join(archive.operationPath, fileName),
      expectedBytes,
      expectedHash,
    );
    assertMagic(bytes, mimeType);
    return bytes;
  } finally {
    await archive.handle.close();
  }
}

export async function writeArchiveBytes(root: string, sessionId: string, filePath: string, bytes: Buffer): Promise<string> {
  const archive = await openSessionDirectory(root, sessionId, true);
  const path = join(archive.canonicalRoot, sessionId, filePath);
  const sha256 = digest(bytes);
  const temporaryName = `.image-${randomBytes(16).toString("hex")}.tmp`;
  const temporaryPath = join(archive.operationPath, temporaryName);
  const destination = join(archive.operationPath, filePath);
  let temporaryCreated = false;
  try {
    const handle = await open(temporaryPath, fileWriteFlags, 0o600);
    temporaryCreated = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporaryPath, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFileExactly(destination, bytes.length, sha256);
      if (!existing.equals(bytes)) fail("Existing archived image is not an exact match");
    }
  } finally {
    if (temporaryCreated) await unlink(temporaryPath).catch(() => {});
    await archive.handle.close();
  }
  return path;
}
