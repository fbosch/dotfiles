import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { chmod, link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifierImage,
  classifierImagePart,
  MAX_IMAGE_BYTES,
  readImageArtifact,
  saveImageArtifact,
} from "../image-artifact";

const MAGICK = "/run/current-system/sw/bin/magick";
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function tempRoot(): Promise<{ base: string; root: string }> {
  const base = await mkdtemp(join(tmpdir(), "image-artifact-test-"));
  roots.push(base);
  const root = join(base, "archive");
  await mkdir(root, { mode: 0o700 });
  return { base, root };
}

function runMagick(args: string[], input?: Buffer, maxOutput = 5_000_000): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(MAGICK, args, {
      cwd: "/",
      env: { PATH: "/run/current-system/sw/bin:/usr/bin:/bin", HOME: "/nonexistent", LC_ALL: "C" },
      shell: false,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxOutput) child.kill("SIGKILL");
      else chunks.push(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code !== 0) rejectPromise(new Error("Synthetic ImageMagick fixture failed"));
      else resolvePromise(Buffer.concat(chunks, size));
    });
    child.stdin.end(input);
  });
}

async function syntheticImage(
  width: number,
  height: number,
  mimeType: "image/png" | "image/jpeg" = "image/png",
): Promise<Buffer> {
  const format = mimeType === "image/png" ? "png" : "jpeg";
  const args = ["-size", `${width}x${height}`, "xc:white"];
  if (width === 720 && height === 131) {
    args.push(
      "-fill", "#111111",
      "-draw", "rectangle 10,10 80,60",
      "-stroke", "#2255aa",
      "-strokewidth", "3",
      "-draw", "line 0,100 719,100",
      "-fill", "#cc3333",
      "-draw", "rectangle 500,20 550,90",
    );
  } else {
    args.push("-fill", "#222222", "-draw", `rectangle 10,10 ${Math.min(width - 1, 100)},${Math.min(height - 1, 100)}`);
  }
  if (format === "jpeg") args.push("-quality", "88");
  args.push(`${format}:-`);
  return runMagick(args);
}

async function dimensions(bytes: Buffer, mimeType: "image/png" | "image/jpeg") {
  const coder = mimeType === "image/png" ? "png:-" : "jpeg:-";
  const result = await runMagick([coder, "-format", "%w %h", "info:-"], bytes, 256);
  const [width, height] = result.toString("ascii").trim().split(" ").map(Number);
  if (width === undefined || height === undefined || !Number.isFinite(width) || !Number.isFinite(height)) throw new Error("Invalid synthetic image dimensions");
  return { width, height };
}

async function pixel(bytes: Buffer, x: number, y: number) {
  const result = await runMagick(
    ["png:-", "-format", `%[pixel:p{${x},${y}}]`, "info:-"],
    bytes,
    256,
  );
  return result.toString("ascii");
}

const imagePayload = (bytes: Buffer, mimeType = "image/png") => ({
  data: bytes.toString("base64"),
  mimeType,
});

const save = (
  root: string,
  bytes: Buffer,
  sessionId = "session_1",
  entryId = "entry_1",
  blockIndex = 0,
) => saveImageArtifact(root, sessionId, entryId, blockIndex, imagePayload(bytes));

test("rejects hard-linked image archives without changing their original bytes", async () => {
  const { root } = await tempRoot();
  const original = await syntheticImage(720, 131);
  const record = await save(root, original);
  await link(record.path, join(root, "external-alias.png"));
  await expect(readImageArtifact(root, "session_1", record)).rejects.toThrow("hard links");
  expect((await readFile(record.path)).toString("base64")).toBe(original.toString("base64"));
});

test("archives exact original bytes and differentiates source blocks", async () => {
  const { root } = await tempRoot();
  const original = await syntheticImage(720, 131);
  const record = await save(root, original);
  const roundTrip = await readImageArtifact(root, "session_1", record);

  expect(Buffer.from(roundTrip.data, "base64")).toEqual(Buffer.from(original));
  expect(await readFile(record.path)).toEqual(Buffer.from(original));
  expect(roundTrip.mimeType).toBe("image/png");
  expect(record.bytes).toBe(original.length);
  expect(record.sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect((await stat(record.path)).mode & 0o777).toBe(0o600);
  expect((await stat(join(root, "session_1"))).mode & 0o777).toBe(0o700);

  const duplicate = await save(root, original, "session_1", "entry_2", 0);
  const laterBlock = await save(root, original, "session_1", "entry_1", 1);
  expect(new Set([record.id, duplicate.id, laterBlock.id]).size).toBe(3);
  expect((await save(root, original)).path).toBe(record.path);
  const changedPixels = await syntheticImage(721, 131);
  const changed = await save(root, changedPixels);
  expect(changed.id).not.toBe(record.id);

  const damaged = Buffer.from(original);
  damaged[damaged.length - 1] = (damaged[damaged.length - 1] ?? 0) ^ 0xff;
  await writeFile(record.path, damaged);
  await expect(save(root, original)).rejects.toThrow();
  expect(await readFile(record.path)).toEqual(damaged);
});

test("pads a 720x131 chart without cropping and returns bounded classifier pixels", async () => {
  const { root } = await tempRoot();
  const original = await syntheticImage(720, 131);
  const record = await save(root, original);
  const normalized = await classifierImage(root, "session_1", record);
  const bytes = Buffer.from(normalized.data, "base64");
  const size = await dimensions(bytes, "image/png");

  expect(normalized).toMatchObject({ type: "image", mimeType: "image/png" });
  expect(size).toEqual({ width: 720, height: 280 });
  expect(size.width * size.height).toBeGreaterThanOrEqual(78_400);
  expect(size.width * size.height).toBeLessThanOrEqual(2_458_624);
  expect(bytes.length).toBeLessThanOrEqual(500_000);
  expect(await pixel(bytes, 20, 20)).toMatch(/255,255,255/u);
  expect(await pixel(bytes, 20, 95)).toMatch(/17,17,17/u);

  const part = await classifierImagePart(root, "session_1", record);
  expect(part.type).toBe("image_url");
  expect(part.image_url.url.startsWith("data:image/png;base64,")).toBe(true);
});

test("pads a 640x240 PNG to the classifier minimum without changing its archive", async () => {
  const { root } = await tempRoot();
  const original = await syntheticImage(640, 240);
  const record = await save(root, original);
  const normalized = await classifierImage(root, "session_1", record);
  const size = await dimensions(Buffer.from(normalized.data, "base64"), "image/png");

  expect(size).toEqual({ width: 640, height: 280 });
  expect(await readFile(record.path)).toEqual(Buffer.from(original));
});

test("accepts JPEG originals and normalizes them to valid classifier bounds", async () => {
  const { root } = await tempRoot();
  const original = await syntheticImage(320, 240, "image/jpeg");
  const record = await saveImageArtifact(root, "jpeg_session", "jpeg_entry", 2, imagePayload(original, "image/jpeg"));
  const restored = await readImageArtifact(root, "jpeg_session", record);
  const normalized = await classifierImage(root, "jpeg_session", record);
  const bytes = Buffer.from(normalized.data, "base64");
  const size = await dimensions(bytes, "image/jpeg");

  expect(Buffer.from(restored.data, "base64")).toEqual(Buffer.from(original));
  expect(normalized.mimeType).toBe("image/jpeg");
  expect(size.width).toBeGreaterThanOrEqual(280);
  expect(size.height).toBeGreaterThanOrEqual(280);
  expect(size.width * size.height).toBeLessThanOrEqual(2_458_624);
  expect(bytes.length).toBeLessThanOrEqual(500_000);
});

test("downscales oversized images within pixel, dimension, and encoded-byte bounds", async () => {
  const { root } = await tempRoot();
  const original = await syntheticImage(2_200, 1_800);
  const record = await save(root, original);
  const normalized = await classifierImage(root, "session_1", record);
  const bytes = Buffer.from(normalized.data, "base64");
  const size = await dimensions(bytes, "image/png");

  expect(size.width).toBeLessThanOrEqual(1_568);
  expect(size.height).toBeLessThanOrEqual(1_568);
  expect(size.width * size.height).toBeLessThanOrEqual(2_458_624);
  expect(bytes.length).toBeLessThanOrEqual(500_000);
});

test("rejects oversized, malformed, mismatched, and traversal inputs", async () => {
  const { root } = await tempRoot();
  const original = await syntheticImage(40, 40);
  const tooLarge = "A".repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4);

  await expect(saveImageArtifact(root, "session_1", "entry_1", 0, { data: tooLarge, mimeType: "image/png" })).rejects.toThrow();
  await expect(saveImageArtifact(root, "session_1", "entry_1", 0, { data: "!!!!", mimeType: "image/png" })).rejects.toThrow();
  await expect(saveImageArtifact(root, "session_1", "entry_1", 0, { data: "Zm9v", mimeType: "image/png" })).rejects.toThrow();
  await expect(saveImageArtifact(root, "session_1", "entry_1", 0, imagePayload(original, "image/webp"))).rejects.toThrow();
  await expect(saveImageArtifact(root, "session_1", "entry_1", 0, imagePayload(original, "image/jpeg"))).rejects.toThrow();
  await expect(saveImageArtifact(root, "../escape", "entry_1", 0, imagePayload(original))).rejects.toThrow();
  await expect(saveImageArtifact(root, "session_1", "../escape", 0, imagePayload(original))).rejects.toThrow();
});

test("rejects symlinked session and image paths without following them", async () => {
  const { base, root } = await tempRoot();
  const outside = join(base, "outside");
  const original = await syntheticImage(40, 40);
  await mkdir(outside, { mode: 0o700 });
  await symlink(outside, join(root, "linked_session"));
  await expect(save(root, original, "linked_session")).rejects.toThrow();
  expect(await readdir(outside)).toEqual([]);

  const record = await save(root, original);
  const outsideFile = join(outside, "outside.png");
  await writeFile(outsideFile, original, { mode: 0o600 });
  await rm(record.path);
  await symlink(outsideFile, record.path);
  await expect(readImageArtifact(root, "session_1", record)).rejects.toThrow();

});
test("reads enforce private permissions without mutating them and follow trusted root aliases", async () => {
  const { base, root } = await tempRoot();
  const original = await syntheticImage(40, 40);
  const record = await save(root, original);
  const alias = join(base, "trusted-cache-link");
  await symlink(root, alias);
  expect((await readImageArtifact(alias, "session_1", record)).data).toBe(original.toString("base64"));

  await chmod(root, 0o750);
  await expect(readImageArtifact(root, "session_1", record)).rejects.toThrow("not owner-only");
  expect((await stat(root)).mode & 0o777).toBe(0o750);
  await chmod(root, 0o700);

  const sessionPath = join(root, "session_1");
  await chmod(sessionPath, 0o750);
  await expect(readImageArtifact(root, "session_1", record)).rejects.toThrow("not owner-only");
  expect((await stat(sessionPath)).mode & 0o777).toBe(0o750);
});

test("rejects non-directory sessions, directory artifacts, and tampered records", async () => {
  const { root } = await tempRoot();
  const original = await syntheticImage(40, 40);
  const sessionFile = join(root, "file_session");
  await writeFile(sessionFile, "not a directory");
  await expect(save(root, original, "file_session")).rejects.toThrow();

  const record = await save(root, original);
  const badHash = `${record.sha256[0] === "0" ? "1" : "0"}${record.sha256.slice(1)}`;
  await expect(readImageArtifact(root, "session_1", { ...record, sha256: badHash })).rejects.toThrow();
  await expect(readImageArtifact(root, "session_1", { ...record, path: `${record.path}/../outside.png` })).rejects.toThrow();
  await expect(readImageArtifact(root, "other_session", record)).rejects.toThrow();
  await expect(readImageArtifact(root, "session_1", { ...record, bytes: record.bytes + 1 })).rejects.toThrow();

  await rm(record.path);
  await mkdir(record.path, { mode: 0o700 });
  await expect(readImageArtifact(root, "session_1", record)).rejects.toThrow();
});

test("aborts image decoding promptly when the caller cancels", async () => {
  const { root } = await tempRoot();
  const original = await syntheticImage(2_700, 2_700, "image/jpeg");
  const record = await saveImageArtifact(root, "session_1", "entry_1", 0, imagePayload(original, "image/jpeg"));
  const controller = new AbortController();
  const started = performance.now();
  const result = classifierImage(root, "session_1", record, controller.signal);
  setTimeout(() => controller.abort(), 20);

  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(performance.now() - started).toBeLessThan(2_000);
});
