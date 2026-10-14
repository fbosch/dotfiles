import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierApi, ClassifierModel, ClassifierResult } from "@earendil-works/pi-ai";
import {
  assertClassifierInput,
  type ClassifierRegistry,
  type ClassifierRequestContext,
  createClassifierRequester,
  installClassifierGate,
  resolveClassifierPreferences,
} from "../classifier";
import { createNativeClassifierRegistry } from "./native-classifier-registry";

const input: ClassifierRequestContext = {
  state: { task: "Check the layout" },
  questions: {
    clean: {
      type: "bool",
      instructions: "Is the layout readable?",
      criteria: { true: "Readable", false: "Not readable" },
    },
  },
};
const image = { type: "image" as const, data: "AAAA", mimeType: "image/png" };
const imageInput: ClassifierRequestContext = { ...input, images: [image] };
let directory: string;
let textModel: ClassifierModel<ClassifierApi>;
let imageModel: ClassifierModel<ClassifierApi>;

beforeAll(async () => {
  const native = await createNativeClassifierRegistry();
  const model = native.findOfType("classifier", "openrouter", "typesafe/jev-1.13");
  if (!model) throw new Error("Missing native Jev fixture");
  textModel = model;
  imageModel = {
    ...model,
    provider: "openrouter",
    id: "openai/gpt-6-luna-decisions",
    api: "fixture-vision",
    input: ["text", "image"],
  };
});
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "classifier-routing-"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function settings(classifier: unknown): void {
  writeFileSync(join(directory, "settings.json"), JSON.stringify({ classifier }));
}
function success(model: ClassifierModel<ClassifierApi>): ClassifierResult {
  return {
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: 0,
    stopReason: "stop",
    answers: { clean: { type: "bool", probability: 0.9 } },
  };
}
function registry(
  models: ClassifierModel<ClassifierApi>[] = [
    textModel,
    { ...textModel, provider: "vercel-ai-gateway", id: "typesafe-ai/jev" },
    imageModel,
  ],
  classify: ClassifierRegistry["classify"] = async (model) => success(model),
): ClassifierRegistry {
  return {
    findOfType: (_type, provider, id) =>
      models.find((model) => model.provider === provider && model.id === id),
    classify,
  };
}
function requester(now: () => number = Date.now) {
  return createClassifierRequester(now, directory);
}

describe("input-aware classifier routing", () => {
  test("keeps text-only and empty-image requests on Jev", async () => {
    const calls: string[] = [];
    const fake = registry(undefined, async (model) => {
      calls.push(model.id);
      return success(model);
    });
    for (const request of [input, { ...input, images: [] }])
      expect((await requester()(fake, request)).ok).toBe(true);
    expect(calls).toEqual(["typesafe/jev-1.13", "typesafe/jev-1.13"]);
  });

  test("routes explicit images to Luna without changing state, questions, or images", async () => {
    const calls: string[] = [];
    const fake = registry(undefined, async (model, request, options) => {
      calls.push(model.id);
      expect(request).toBe(imageInput);
      expect(options?.maxRetries).toBe(0);
      return success(model);
    });
    expect(await requester()(fake, imageInput)).toMatchObject({
      ok: true,
      value: { answers: { clean: { type: "bool", probability: 0.9 } } },
    });
    expect(calls).toEqual(["openai/gpt-6-luna-decisions"]);
  });

  test("supports configured registered models and skips incompatible image candidates", async () => {
    settings({
      imageProviders: [
        { provider: textModel.provider, model: textModel.id },
        { provider: "custom-vision", model: "vision-v2" },
      ],
    });
    const custom = { ...imageModel, provider: "custom-vision", id: "vision-v2" };
    const calls: string[] = [];
    const fake = registry([textModel, custom], async (model, request) => {
      calls.push(model.id);
      expect(request).toBe(imageInput);
      return success(model);
    });
    expect((await requester()(fake, imageInput)).ok).toBe(true);
    expect(calls).toEqual(["vision-v2"]);
  });

  test("supports configured text models without a Jev-specific ID whitelist", async () => {
    const custom = { ...textModel, provider: "custom-text", id: "clef-v2" };
    settings({ providers: [{ provider: custom.provider, model: custom.id }] });
    const calls: string[] = [];
    const fake = registry([custom], async (model) => {
      calls.push(model.id);
      return success(model);
    });
    expect((await requester()(fake, input)).ok).toBe(true);
    expect(calls).toEqual(["clef-v2"]);
  });

  test("falls back only between image-capable models and preserves images", async () => {
    const fallback = { ...imageModel, provider: "fallback-vision", id: "vision-backup" };
    settings({
      imageProviders: [
        { provider: imageModel.provider, model: imageModel.id },
        { provider: textModel.provider, model: textModel.id },
        { provider: fallback.provider, model: fallback.id },
      ],
    });
    const calls: string[] = [];
    const fake = registry([textModel, imageModel, fallback], async (model, request, options) => {
      calls.push(model.id);
      expect(request).toBe(imageInput);
      await options?.fetch?.("https://classifier.invalid");
      return model.id === imageModel.id
        ? { ...success(model), stopReason: "error", answers: {} }
        : success(model);
    });
    let fetches = 0;
    expect(
      (
        await requester()(fake, imageInput, {
          fetch: async () => new Response(null, { status: ++fetches === 1 ? 503 : 200 }),
        })
      ).ok,
    ).toBe(true);
    expect(calls).toEqual(["openai/gpt-6-luna-decisions", "vision-backup"]);
    expect(fetches).toBe(2);
  });

  test("does not send image requests to Jev when vision models are missing or incompatible", async () => {
    for (const imageProviders of [
      undefined,
      [{ provider: textModel.provider, model: textModel.id }],
      [{ provider: "missing", model: "vision" }],
    ]) {
      settings(imageProviders ? { imageProviders } : {});
      let calls = 0;
      const fake = registry([textModel], async (model) => {
        calls++;
        return success(model);
      });
      expect(await requester()(fake, imageInput)).toMatchObject({
        ok: false,
        stage: "config",
        reason: "model-unavailable",
      });
      expect(calls).toBe(0);
    }
  });

  test("re-resolves capabilities and settings on each request", async () => {
    let current = { ...imageModel, input: ["text"] as ("text" | "image")[] };
    const fake: ClassifierRegistry = {
      findOfType: () => current,
      classify: async (model) => success(model),
    };
    const request = requester();
    expect((await request(fake, imageInput)).ok).toBe(false);
    current = imageModel;
    expect((await request(fake, imageInput)).ok).toBe(true);
    settings({ imageProviders: [{ provider: textModel.provider, model: textModel.id }] });
    const calls: string[] = [];
    const changed = registry([textModel], async (model) => {
      calls.push(model.id);
      return success(model);
    });
    expect((await request(changed, imageInput)).ok).toBe(false);
    expect(calls).toEqual([]);
  });

  test("gives the sole compatible model the full timeout budget", async () => {
    settings({
      imageProviders: [
        { provider: textModel.provider, model: textModel.id },
        { provider: imageModel.provider, model: imageModel.id },
      ],
    });
    const fake = registry(undefined, async (model) => {
      await Bun.sleep(40);
      return success(model);
    });
    expect((await requester()(fake, imageInput, { timeoutMs: 60 })).ok).toBe(true);
  });

  test("bounds uncooperative vision calls and cancels without text fallback", async () => {
    let calls = 0;
    const fake = registry(undefined, async () => {
      calls++;
      return new Promise<ClassifierResult>(() => {});
    });
    expect(await requester()(fake, imageInput, { timeoutMs: 20 })).toMatchObject({
      ok: false,
      reason: "timeout",
    });
    expect(calls).toBe(1);
    const controller = new AbortController();
    controller.abort();
    expect(await requester()(fake, imageInput, { signal: controller.signal })).toMatchObject({
      ok: false,
      reason: "caller-cancellation",
    });
    expect(calls).toBe(1);
  });

  test("in-flight cancellation stops image fallback", async () => {
    const backup = { ...imageModel, provider: "backup", id: "vision" };
    settings({
      imageProviders: [
        { provider: imageModel.provider, model: imageModel.id },
        { provider: backup.provider, model: backup.id },
      ],
    });
    const controller = new AbortController();
    let calls = 0;
    const fake = registry([imageModel, backup], async (model) => {
      calls++;
      controller.abort();
      return success(model);
    });
    expect(await requester()(fake, imageInput, { signal: controller.signal })).toMatchObject({
      ok: false,
      reason: "caller-cancellation",
    });
    expect(calls).toBe(1);
  });

  test("honors cooldowns across image candidates on the same provider and at expiry", async () => {
    const backup = { ...imageModel, id: "luna-backup" };
    settings({
      imageProviders: [
        { provider: imageModel.provider, model: imageModel.id },
        { provider: backup.provider, model: backup.id },
      ],
    });
    let now = 0;
    let calls = 0;
    const fake = registry([imageModel, backup], async (model, _request, options) => {
      calls++;
      await options?.fetch?.("https://classifier.invalid");
      return success(model);
    });
    const request = requester(() => now);
    const options = {
      fetch: async () => new Response(null, { status: 429, headers: { "Retry-After": "2" } }),
    };
    for (const _ of [0, 1])
      expect(await request(fake, imageInput, options)).toMatchObject({
        ok: false,
        reason: "http-status",
        provider: "openrouter",
        retryAfterMs: 2_000,
      });
    expect(calls).toBe(1);
    now = 2_000;
    await request(fake, imageInput, options);
    expect(calls).toBe(2);
  });

  test("master disable gates both the shared image route and the native classifier boundary", async () => {
    settings({ enabled: false });
    let calls = 0;
    let lookups = 0;
    const fake: ClassifierRegistry = {
      findOfType: () => {
        lookups++;
        return imageModel;
      },
      classify: async (model) => {
        calls++;
        return success(model);
      },
    };
    const restore = installClassifierGate(
      fake,
      { cwd: directory, isProjectTrusted: () => false },
      directory,
    );
    try {
      expect(await requester()(fake, imageInput)).toEqual({
        ok: false,
        stage: "config",
        reason: "disabled",
      });
      expect((await fake.classify(imageModel, imageInput)).stopReason).toBe("error");
      expect(calls).toBe(0);
      expect(lookups).toBe(0);
      settings({ enabled: true });
      expect((await requester()(fake, imageInput)).ok).toBe(true);
      expect(calls).toBe(1);
    } finally {
      restore();
    }
  });

  test("keeps the JSON budget separate from bounded image payloads", async () => {
    const largeImage = { ...image, data: Buffer.alloc(75_000).toString("base64") };
    const valid = { ...input, images: [largeImage] };
    expect((await requester()(registry(), valid)).ok).toBe(true);
    const oversized = { ...valid, state: { text: "x".repeat(64_000) } };
    expect(await requester()(registry(), oversized)).toMatchObject({
      ok: false,
      reason: "invalid-input",
    });
    for (const images of [
      [{ ...image, data: "" }],
      [{ ...image, data: "not base64" }],
      [{ ...image, data: "AAAAA" }],
      [{ ...image, mimeType: "text/html" }],
      [{ ...image, data: "A".repeat(5 * 1024 * 1024 + 4) }],
      Array.from({ length: 5 }, () => image),
    ])
      expect(() => assertClassifierInput({ ...input, images })).toThrow();
  });

  test("validates both routes, bounded preference lists, and unique provider/model pairs", () => {
    expect(resolveClassifierPreferences(undefined, "image")).toEqual([
      { provider: "openrouter", model: "openai/gpt-6-luna-decisions" },
    ]);
    const preference = { provider: "custom", model: "vision" };
    for (const invalid of [
      null,
      [],
      "invalid",
      [preference, preference],
      [{ ...preference, provider: " " }],
      [{ ...preference, model: "" }],
    ])
      expect(
        resolveClassifierPreferences({ classifier: { imageProviders: invalid } }),
      ).toBeUndefined();
    expect(resolveClassifierPreferences({ classifier: { providers: null } })).toBeUndefined();
    expect(resolveClassifierPreferences({ classifier: null })).toBeUndefined();
    expect(
      resolveClassifierPreferences({
        classifier: {
          imageProviders: Array.from({ length: 9 }, (_, i) => ({
            ...preference,
            model: String(i),
          })),
        },
      }),
    ).toBeUndefined();
  });
});
