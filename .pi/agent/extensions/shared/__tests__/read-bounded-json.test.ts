import { describe, expect, test } from "bun:test";
import { readBoundedJson } from "../read-bounded-json";

describe("readBoundedJson", () => {
  test("parses a streamed JSON response", async () => {
    await expect(readBoundedJson(Response.json({ value: "ok" }))).resolves.toEqual({ value: "ok" });
  });

  test("returns undefined for responses without a body", async () => {
    await expect(readBoundedJson(new Response(null))).resolves.toBeUndefined();
  });

  test("preserves native JSON parse errors", async () => {
    await expect(readBoundedJson(new Response("not-json"))).rejects.toBeInstanceOf(SyntaxError);
  });

  test("rejects oversized content lengths before reading the body", async () => {
    await expect(
      readBoundedJson(
        new Response(null, { headers: { "content-length": String(1024 * 1024 + 1) } }),
      ),
    ).rejects.toThrow("response is too large");
  });

  test("cancels streams that exceed the byte limit", async () => {
    let cancelled = false;
    let chunkCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunkCount += 1;
        controller.enqueue(new Uint8Array(chunkCount === 1 ? 1024 * 1024 : 1));
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(readBoundedJson(new Response(stream))).rejects.toThrow("response is too large");
    expect(cancelled).toBe(true);
  });
});
