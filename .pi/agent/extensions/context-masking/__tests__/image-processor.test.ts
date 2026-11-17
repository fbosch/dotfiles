import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { normalizeImageForClassifier, runImageProcessor, validateImageInput } from "../image-artifact";
import { solidImage, syntheticImage } from "./image-fixtures";

const execFileAsync = promisify(execFile);
const imageInput = (bytes: Buffer) => ({ data: bytes.toString("base64"), mimeType: "image/png" });

test("validates and normalizes image bytes using the running runtime with an empty PATH", async () => {
  const original = await solidImage();
  const path = process.env.PATH;
  try {
    process.env.PATH = "";
    const validated = await validateImageInput(imageInput(original));
    expect(validated.bytes).toEqual(original);
    const output = await normalizeImageForClassifier(validated.bytes, validated.mimeType);
    expect(await sharp(output).metadata()).toMatchObject({ width: 720, height: 280 });
  } finally {
    process.env.PATH = path;
  }
});

test("rejects images exceeding decoded pixel and dimension limits before normalization", async () => {
  for (const [width, height] of [[3000, 3000], [10001, 1]] as const) {
    const original = await solidImage("white", width, height);
    await expect(validateImageInput(imageInput(original))).rejects.toThrow();
  }
});

test("validates the full pixel stream rather than accepting readable metadata", async () => {
  const original = await syntheticImage(720, 131);
  const truncated = original.subarray(0, original.length - 20);
  expect(await sharp(truncated).metadata()).toMatchObject({ width: 720, height: 131 });
  await expect(validateImageInput(imageInput(truncated))).rejects.toThrow();
});

test("rejects the PNG animation marker even when a decoder could expose only its first frame", async () => {
  const original = await solidImage();
  const control = Buffer.alloc(20);
  control.writeUInt32BE(8, 0);
  control.write("acTL", 4, "ascii");
  control.writeUInt32BE(2, 8);
  control.writeUInt32BE(crc32(control.subarray(4, 16)), 16);
  const animated = Buffer.concat([original.subarray(0, 33), control, original.subarray(33)]);
  await expect(validateImageInput(imageInput(animated))).rejects.toThrow("Animated or multi-frame");
});

test("auto-orients JPEGs and flattens transparent PNGs onto white without upscaling", async () => {
  const jpeg = await sharp({ create: { width: 640, height: 240, channels: 3, background: "red" } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const oriented = await normalizeImageForClassifier(jpeg, "image/jpeg");
  expect(await sharp(oriented).metadata()).toMatchObject({ width: 280, height: 640 });
  const png = await sharp({ create: { width: 100, height: 100, channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const flattened = await normalizeImageForClassifier(png, "image/png");
  expect(await sharp(flattened).metadata()).toMatchObject({ width: 280, height: 280, hasAlpha: false });
  const { data } = await sharp(flattened).raw().toBuffer({ resolveWithObject: true });
  expect(data.every(value => value === 255)).toBe(true);
});

test("terminates timed-out and cancelled decoder processes and permits subsequent work", async () => {
  const bytes = await solidImage();
  await expect(runImageProcessor("normalize", bytes, "image/png", { timeoutMs: 1 })).rejects.toThrow("timed out");
  const controller = new AbortController();
  const processing = runImageProcessor("normalize", bytes, "image/png", { signal: controller.signal });
  const abort = setTimeout(() => controller.abort(), 1);
  try {
    await expect(processing).rejects.toMatchObject({ name: "AbortError" });
  } finally {
    clearTimeout(abort);
  }
  await expect(runImageProcessor("inspect", bytes, "image/png")).resolves.toEqual(Buffer.alloc(0));
});

const agentDir = new URL("../../../", import.meta.url).pathname;
test("loads Sharp and its isolated decoder through Node/Jiti", async () => {
  const image = imageInput(await solidImage());
  const source = `import { createJiti } from "jiti";
    const jiti = createJiti(import.meta.url, { fsCache: false });
    const codec = await jiti.import("./extensions/context-masking/image-artifact.ts");
    const result = await codec.validateImageInput(${JSON.stringify(image)});
    console.log(result.bytes.length);`;
  const { stdout, stderr } = await execFileAsync("node", ["--input-type=module", "--eval", source], {
    cwd: agentDir, timeout: 15_000, env: { PATH: process.env.PATH ?? "", HOME: "/nonexistent" },
  });
  expect(Number(stdout.trim())).toBe(Buffer.from(image.data, "base64").length);
  expect(stderr).toBe("");
}, 20_000);
