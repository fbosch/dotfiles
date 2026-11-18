import { expect, test } from "bun:test";
import { ImageNormalizationCache } from "../image-normalization-cache";

test("normalization cache owns its stored and returned byte buffers", () => {
  const cache = new ImageNormalizationCache(2, 10);
  const bytes = Buffer.from("first");
  cache.set("a", bytes);
  bytes[0] = 0;
  const result = cache.get("a");
  expect(result?.toString()).toBe("first");
  if (result) result[0] = 0;
  expect(cache.get("a")?.toString()).toBe("first");
});

test("normalization cache evicts least-recently-used entries by count and total bytes", () => {
  const cache = new ImageNormalizationCache(2, 6);
  cache.set("a", Buffer.from("aa"));
  cache.set("b", Buffer.from("bb"));
  cache.get("a");
  cache.set("c", Buffer.from("cc"));
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("a")?.toString()).toBe("aa");
  cache.set("d", Buffer.from("dddd"));
  expect(cache.get("c")).toBeUndefined();
  expect(cache.get("a")?.toString()).toBe("aa");
  expect(cache.get("d")?.toString()).toBe("dddd");
});

test("oversized copies cannot displace bounded cache contents", () => {
  const cache = new ImageNormalizationCache(2, 4);
  cache.set("a", Buffer.from("aa"));
  cache.set("large", Buffer.from("large"));
  expect(cache.get("large")).toBeUndefined();
  expect(cache.get("a")?.toString()).toBe("aa");
});
