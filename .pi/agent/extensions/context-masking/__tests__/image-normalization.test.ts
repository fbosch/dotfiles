import { randomPng } from "./image-fixtures";
import { expect, test } from "bun:test";
import sharp from "sharp";
import { normalizeImageForClassifier } from "../image-artifact";

async function texturedJpeg() {
  const width = 1600, height = 1200;
  const raw = Buffer.alloc(width * height * 3);
  let seed = 123456789;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const noise = (seed >>> 0) % 32;
    const offset = (y * width + x) * 3;
    raw[offset] = (x / width * 180 + noise) | 0;
    raw[offset + 1] = (y / height * 180 + noise) | 0;
    raw[offset + 2] = ((x + y) / (width + height) * 160 + noise) | 0;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
}


test("JPEG encoding retries fit high-detail evidence without reducing its initial geometry", async () => {
  const original = await texturedJpeg();
  const decoded = await sharp(original).raw().toBuffer({ resolveWithObject: true });
  const initial = await sharp(decoded.data, { raw: decoded.info })
    .resize(1568, 1176, { fit: "fill" }).jpeg({ quality: 88, chromaSubsampling: "4:4:4" }).toBuffer();
  expect(initial.length).toBeGreaterThan(500_000);
  const snapshot = original.toString("base64");
  const output = await normalizeImageForClassifier(original, "image/jpeg");
  expect(output.length).toBeLessThanOrEqual(500_000);
  expect(await sharp(output).metadata()).toMatchObject({ format: "jpeg", width: 1568, height: 1176 });
  expect(original.toString("base64")).toBe(snapshot);
});

test("lossless PNG encoding uses only bounded downscaling when full-sized pixels cannot fit", async () => {
  const original = await randomPng(640, 400);
  expect(original.length).toBeGreaterThan(500_000);
  const output = await normalizeImageForClassifier(original, "image/png");
  const size = await sharp(output).metadata();
  expect(output.length).toBeLessThanOrEqual(500_000);
  expect(size.format).toBe("png");
  expect(size.width).toBeLessThan(640);
  expect(size.width).toBeGreaterThanOrEqual(448);
  expect(size.height).toBeGreaterThanOrEqual(280);
});

test("images still above the byte ceiling fail rather than shrinking beyond the quality policy", async () => {
  const original = await randomPng(1200, 1000);
  expect(original.length).toBeLessThan(4_000_000);
  await expect(normalizeImageForClassifier(original, "image/png")).rejects.toThrow("bounded encoding retries");
});
