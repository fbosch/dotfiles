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
const MAGICK = "/run/current-system/sw/bin/magick";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

const IMAGE_MIME = ["image/png", "image/jpeg"] as const;
export type ImageMime = (typeof IMAGE_MIME)[number];

type ImageDimensions = { width: number; height: number };
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
  PATH: "/run/current-system/sw/bin:/usr/bin:/bin",
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

function resourceArgs(): string[] {
  return [
    "-limit", "memory", "256MiB",
    "-limit", "map", "0",
    "-limit", "disk", "0",
    "-limit", "area", String(MAX_DECODE_AREA),
    "-limit", "width", "10000",
    "-limit", "height", "10000",
    "-limit", "time", "12",
    "-limit", "thread", "1",
  ];
}

function runMagick(
  args: string[],
  input: Buffer,
  maxOutputBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  checkImageProcessingAbort(signal);
  return new Promise((resolvePromise, rejectPromise) => {
    let child: ChildProcessByStdio<Writable, Readable, null>;
    try {
      child = spawn(MAGICK, args, {
        cwd: "/",
        env: childEnv,
        shell: false,
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      rejectPromise(new Error("ImageMagick could not be started"));
      return;
    }

    let outputBytes = 0;
    let failure: Error | undefined;
    const chunks: Buffer[] = [];
    const stop = (error: Error) => {
      if (failure !== undefined) return;
      failure = error;
      child.kill("SIGKILL");
    };
    const onAbort = () => stop(abortError());
    const timeout = setTimeout(() => stop(new Error("Image processing timed out")), 15_000);
    timeout.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();

    child.stdout.on("data", (part: Buffer) => {
      if (failure !== undefined) return;
      outputBytes += part.length;
      if (outputBytes > maxOutputBytes) {
        stop(new Error("ImageMagick output exceeded its limit"));
        return;
      }
      chunks.push(part);
    });
    child.stdin.on("error", () => {});
    child.on("error", () => {
      stop(new Error("ImageMagick could not be started"));
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (failure !== undefined) {
        rejectPromise(failure);
      } else if (code !== 0) {
        rejectPromise(new Error("ImageMagick rejected the image"));
      } else if (signal?.aborted) {
        rejectPromise(abortError());
      } else {
        resolvePromise(Buffer.concat(chunks, outputBytes));
      }
    });
    child.stdin.end(input);
  });
}

function inputCoder(mimeType: ImageMime): string {
  return mimeType === "image/png" ? "png:-" : "jpeg:-";
}

async function inspectImage(
  bytes: Buffer,
  mimeType: ImageMime,
  signal?: AbortSignal,
): Promise<ImageDimensions> {
  const output = await runMagick(
    [
      ...resourceArgs(),
      inputCoder(mimeType),
      "-auto-orient",
      "-format",
      "%n %w %h\\n",
      "info:-",
    ],
    bytes,
    256,
    signal,
  );
  const lines = output.toString("ascii").trim().split("\n");
  if (lines.length !== 1) fail("Animated or multi-frame images are not supported");
  const match = /^(\d+) (\d+) (\d+)$/u.exec(lines[0] ?? "");
  if (match === null || match[1] !== "1") fail("Invalid image dimensions or frame count");
  const width = Number(match[2]);
  const height = Number(match[3]);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 10_000 ||
    height > 10_000 ||
    width * height > MAX_DECODE_AREA
  )
    fail("Image exceeds decode limits");
  return { width, height };
}

export async function validateImageInput(image: ImageInput): Promise<{ bytes: Buffer; mimeType: ImageMime }> {
  const mimeType = imageMime(image?.mimeType ?? "");
  const bytes = decodeBase64(image?.data);
  assertMagic(bytes, mimeType);
  await inspectImage(bytes, mimeType);
  return { bytes, mimeType };
}

function normalizedDimensions({ width, height }: ImageDimensions): ImageDimensions {
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / width,
    MAX_IMAGE_DIMENSION / height,
    Math.sqrt(MAX_IMAGE_AREA / (width * height)),
  );
  const resizedWidth = Math.max(1, Math.floor(width * scale));
  const resizedHeight = Math.max(1, Math.floor(height * scale));
  let canvasWidth = Math.max(MIN_IMAGE_DIMENSION, resizedWidth);
  let canvasHeight = Math.max(MIN_IMAGE_DIMENSION, resizedHeight);

  if (canvasWidth * canvasHeight < MIN_IMAGE_AREA) {
    const paddingScale = Math.sqrt(MIN_IMAGE_AREA / (canvasWidth * canvasHeight));
    canvasWidth = Math.min(MAX_IMAGE_DIMENSION, Math.ceil(canvasWidth * paddingScale));
    canvasHeight = Math.min(MAX_IMAGE_DIMENSION, Math.ceil(canvasHeight * paddingScale));
    while (canvasWidth * canvasHeight < MIN_IMAGE_AREA && canvasWidth < MAX_IMAGE_DIMENSION)
      canvasWidth++;
    while (canvasWidth * canvasHeight < MIN_IMAGE_AREA && canvasHeight < MAX_IMAGE_DIMENSION)
      canvasHeight++;
  }
  if (
    canvasWidth < MIN_IMAGE_DIMENSION ||
    canvasHeight < MIN_IMAGE_DIMENSION ||
    canvasWidth > MAX_IMAGE_DIMENSION ||
    canvasHeight > MAX_IMAGE_DIMENSION ||
    canvasWidth * canvasHeight < MIN_IMAGE_AREA ||
    canvasWidth * canvasHeight > MAX_IMAGE_AREA
  )
    fail("Image cannot be normalized within classifier bounds");
  return { width: canvasWidth, height: canvasHeight };
}

async function normalizeImage(
  bytes: Buffer,
  mimeType: ImageMime,
  signal?: AbortSignal,
): Promise<Buffer> {
  checkImageProcessingAbort(signal);
  const source = await inspectImage(bytes, mimeType, signal);
  const size = normalizedDimensions(source);
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / source.width,
    MAX_IMAGE_DIMENSION / source.height,
    Math.sqrt(MAX_IMAGE_AREA / (source.width * source.height)),
  );
  const resizedWidth = Math.max(1, Math.floor(source.width * scale));
  const resizedHeight = Math.max(1, Math.floor(source.height * scale));
  const output = await runMagick(
    [
      ...resourceArgs(),
      inputCoder(mimeType),
      "-auto-orient",
      "-resize",
      `${resizedWidth}x${resizedHeight}`,
      "-background",
      "white",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      "-gravity",
      "center",
      "-extent",
      `${size.width}x${size.height}`,
      "-strip",
      ...(mimeType === "image/jpeg" ? ["-quality", "88", "-sampling-factor", "4:4:4"] : []),
      mimeType === "image/png" ? "png:-" : "jpeg:-",
    ],
    bytes,
    MAX_CLASSIFIER_BYTES,
    signal,
  );
  checkImageProcessingAbort(signal);
  const verified = await inspectImage(output, mimeType, signal);
  if (
    output.length === 0 ||
    output.length > MAX_CLASSIFIER_BYTES ||
    verified.width !== size.width ||
    verified.height !== size.height ||
    verified.width < MIN_IMAGE_DIMENSION ||
    verified.height < MIN_IMAGE_DIMENSION ||
    verified.width > MAX_IMAGE_DIMENSION ||
    verified.height > MAX_IMAGE_DIMENSION ||
    verified.width * verified.height < MIN_IMAGE_AREA ||
    verified.width * verified.height > MAX_IMAGE_AREA
  )
    fail("Normalized image exceeds classifier bounds");
  return output;
}

export function normalizeImageForClassifier(bytes: Buffer, mimeType: string, signal?: AbortSignal): Promise<Buffer> {
  return normalizeImage(bytes, imageMime(mimeType), signal);
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
