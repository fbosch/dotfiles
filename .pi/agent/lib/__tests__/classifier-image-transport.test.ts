import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierApi, ClassifierModel } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
  type ClassifierRegistry,
  type ClassifierRequestContext,
  createClassifierRequester,
  installClassifierGate,
} from "../classifier";
import { createNativeClassifierRegistry } from "./native-classifier-registry";

const image = { type: "image" as const, data: "AAAA", mimeType: "image/png" };
const input: ClassifierRequestContext = {
  state: { task: "Check screenshot", nested: { preserved: true } },
  images: [image, { ...image, data: "AAAB", mimeType: "image/webp" }],
  questions: {
    clean: { type: "bool", instructions: "Readable?", criteria: { true: "Yes", false: "No" } },
    color: { type: "choice", instructions: "Color?", criteria: { red: "Red", blue: "Blue" } },
    polish: { type: "score", instructions: "Polish?", criteria: ["Rough", "Polished"] },
  },
};
const wireResponse = {
  answers: {
    clean: { type: "noul", noul: 0.9 },
    color: {
      type: "choice",
      choice: "red",
      probabilities: { red: 0.8, blue: 0.2 },
      confidence: 0.8,
    },
    polish: { type: "score", score: 0.8, confidence: 0.9 },
  },
  usage: { input_tokens: 80, output_tokens: 5 },
};
let directory: string;
let native: ModelRegistry;
let model: ClassifierModel<ClassifierApi>;
beforeAll(async () => {
  native = await createNativeClassifierRegistry();
  const template = native.findOfType("classifier", "openrouter", "typesafe/jev-1.14");
  if (!template) throw new Error("Missing native Jev fixture");
  model = template;
});
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "classifier-image-transport-"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function registry(): ClassifierRegistry {
  return {
    findOfType: (type, provider, id) =>
      provider === model.provider && id === model.id
        ? model
        : native.findOfType(type, provider, id),
    classify: native.classify.bind(native),
  };
}

test("OpenRouter images use documented multimodal state while native auth, mapping, and parsing remain intact", async () => {
  let fetches = 0;
  const result = await createClassifierRequester(Date.now, directory)(registry(), input, {
    fetch: async (url, init) => {
      fetches++;
      expect(String(url)).toBe("https://openrouter.ai/api/alpha/decisions");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer native-classifier-test-key",
      );
      const sent = JSON.parse(String(init?.body));
      expect(sent).toEqual({
        model: model.id,
        state: [
          JSON.stringify(input.state),
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
          { type: "image_url", image_url: { url: "data:image/webp;base64,AAAB" } },
        ],
        questions: {
          ...input.questions,
          clean: { ...input.questions.clean, type: "noul" },
        },
      });
      expect(init?.signal?.aborted).toBe(false);
      return Response.json(wireResponse);
    },
  });
  expect(fetches).toBe(1);
  expect(result).toMatchObject({
    ok: true,
    value: {
      answers: {
        clean: { type: "bool", probability: 0.9 },
        color: { choice: "red" },
        polish: { score: 0.8 },
      },
    },
    usage: { input: 80, output: 5, totalTokens: 85 },
  });
});

test("Jev 1.14 image rejection falls back to Luna without changing image payloads", async () => {
  const attempts: string[] = [];
  const images = input.images;
  if (!images) throw new Error("Missing image fixture");
  const result = await createClassifierRequester(Date.now, directory)(registry(), input, {
    fetch: async (url, init) => {
      expect(String(url)).toBe("https://openrouter.ai/api/alpha/decisions");
      const sent = JSON.parse(String(init?.body));
      attempts.push(sent.model);
      expect(sent.state).toEqual([
        JSON.stringify(input.state),
        ...images.map(({ data, mimeType }) => ({
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${data}` },
        })),
      ]);
      return attempts.length === 1
        ? new Response("Unsupported image", { status: 400 })
        : Response.json(wireResponse);
    },
  });
  expect(result).toMatchObject({ ok: true, value: { answers: { clean: { probability: 0.9 } } } });
  expect(attempts).toEqual(["typesafe/jev-1.14", "openai/gpt-6-luna-decisions"]);
});

test("native classifier gate bridges images once and blocks disabled requests before transport", async () => {
  const fake = registry();
  const restore = installClassifierGate(
    fake,
    { cwd: directory, isProjectTrusted: () => false },
    directory,
  );
  let fetches = 0;
  const fetch = Object.assign(
    async (url: RequestInfo | URL, init?: RequestInit) => {
      fetches++;
      expect(String(url)).toBe("https://openrouter.ai/api/alpha/decisions");
      expect(JSON.parse(String(init?.body)).state).toHaveLength(3);
      return Response.json(wireResponse);
    },
    { preconnect: globalThis.fetch.preconnect },
  );
  try {
    expect((await fake.classify(model, input, { fetch })).stopReason).toBe("stop");
    expect((await createClassifierRequester(Date.now, directory)(fake, input, { fetch })).ok).toBe(
      true,
    );
    expect(fetches).toBe(2);
    writeFileSync(
      join(directory, "settings.json"),
      JSON.stringify({ classifier: { enabled: false } }),
    );
    expect((await fake.classify(model, input, { fetch })).stopReason).toBe("error");
    expect(fetches).toBe(2);
  } finally {
    restore();
  }
});

test("the image bridge fails closed if a native payload hook changes the state shape", async () => {
  const fake = registry();
  const restore = installClassifierGate(
    fake,
    { cwd: directory, isProjectTrusted: () => false },
    directory,
  );
  let fetches = 0;
  try {
    const result = await fake.classify(model, input, {
      onPayload: () => ({ model: model.id, state: "changed", questions: input.questions }),
      fetch: Object.assign(
        async () => {
          fetches++;
          return Response.json(wireResponse);
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    });
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("Unexpected classifier image payload");
    expect(fetches).toBe(0);
  } finally {
    restore();
  }
});

test("unexpected image transport endpoints cannot bypass the native request-shape guard", async () => {
  let fetches = 0;
  const fake: ClassifierRegistry = {
    findOfType: () => model,
    classify: async (_model, request, options) => {
      await options?.fetch?.("https://example.invalid/unexpected", {
        method: "POST",
        body: JSON.stringify({ model: model.id, ...request }),
      });
      throw new Error("Unexpected success");
    },
  };
  expect(
    await createClassifierRequester(Date.now, directory)(fake, input, {
      fetch: async () => {
        fetches++;
        return Response.json(wireResponse);
      },
    }),
  ).toMatchObject({ ok: false });
  expect(fetches).toBe(0);
});
