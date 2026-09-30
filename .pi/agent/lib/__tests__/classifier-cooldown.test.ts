import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierContext } from "@earendil-works/pi-ai";
import { createClassifierRequester } from "../classifier";
import { createNativeClassifierRegistry } from "./native-classifier-registry";

test("retains observed 429 cooldown headers when the native error body never finishes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "classifier-hanging-body-"));
  let body: ReadableStreamDefaultController<Uint8Array> | undefined;
  try {
    writeFileSync(
      join(directory, "settings.json"),
      JSON.stringify({
        classifier: { providers: [{ provider: "openrouter", model: "typesafe/jev-1.13" }] },
      }),
    );
    const registry = await createNativeClassifierRegistry();
    const request = createClassifierRequester(() => 0, directory);
    const input: ClassifierContext = {
      state: {},
      questions: {
        gate: { type: "bool", instructions: "Choose", criteria: { true: "Yes", false: "No" } },
      },
    };
    let fetchCalls = 0;
    const fetch = async () => {
      fetchCalls++;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            body = controller;
          },
        }),
        {
          status: 429,
          headers: { "Retry-After": "2" },
        },
      );
    };
    const first = await request(registry, input, { fetch, timeoutMs: 30 });
    const second = await request(registry, input, { fetch, timeoutMs: 30 });
    for (const result of [first, second])
      expect(result).toMatchObject({
        ok: false,
        reason: "timeout",
        stage: "body",
        provider: "openrouter",
        httpStatus: 429,
        retryAfterMs: 2_000,
      });
    expect(fetchCalls).toBe(1);
  } finally {
    body?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
