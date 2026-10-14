import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionToolContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import typesafeQuestionExtension, {
  latestUserImages,
  normalizeQuestionInput,
  QuestionParameters,
} from "../index";

const image: ImageContent = { type: "image", data: "AAAA", mimeType: "image/png" };
const input = {
  state: { task: "Judge attached screenshot" },
  questions: {
    clean: {
      type: "bool" as const,
      instructions: "Readable?",
      criteria: { true: "Yes", false: "No" },
    },
  },
};
function user(images: ImageContent[] = []): SessionEntry {
  return {
    type: "message",
    id: "user",
    parentId: null,
    timestamp: new Date(0).toISOString(),
    message: {
      role: "user",
      content: [{ type: "text", text: "Check this" }, ...images],
      timestamp: 0,
    },
  };
}

test("attached images are opt-in rather than changing unrelated text classifier calls", () => {
  expect(normalizeQuestionInput(input, [image])).toEqual(input);
  expect(normalizeQuestionInput({ ...input, includeAttachedImages: false }, [image])).toEqual(
    input,
  );
  const request = { ...input, includeAttachedImages: true };
  expect(Value.Check(QuestionParameters, request)).toBe(true);
  expect(normalizeQuestionInput(request, [image])).toEqual({ ...input, images: [image] });
});

test("only the latest user message supplies attachments, never stale images from earlier turns", () => {
  expect(latestUserImages([user([image])])).toEqual([image]);
  expect(latestUserImages([user([image]), user()])).toEqual([]);
  expect(latestUserImages([])).toEqual([]);
});

test("missing requested attachments fail explicitly rather than routing the judgment to Jev", () => {
  expect(() => normalizeQuestionInput({ ...input, includeAttachedImages: true })).toThrow(
    "No images attached to the latest user message",
  );
});

test("explicit and attached images are combined without dropping any or bypassing image bounds", () => {
  const request = { ...input, images: [image], includeAttachedImages: true };
  const another = { ...image, data: "AAAB" };
  expect(normalizeQuestionInput(request, [another])).toEqual({
    ...input,
    images: [image, another],
  });
  expect(() =>
    normalizeQuestionInput(
      request,
      Array.from({ length: 4 }, () => image),
    ),
  ).toThrow();
});

test("registered tool resolves current attachments and delivers them to the image classifier", async () => {
  const directory = mkdtempSync(join(tmpdir(), "question-attachment-tool-"));
  const previousDirectory = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    const registry = await createNativeClassifierRegistry();
    let calls = 0;
    registry.registerProvider("openrouter", {
      models: [
        {
          type: "classifier",
          id: "openai/gpt-6-luna-decisions",
          name: "Attachment fixture",
          api: "fixture-vision",
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 64_000,
        },
      ],
      classifiers: {
        "fixture-vision": {
          classify: async (model, request) => {
            calls++;
            const expected = { ...input, images: [image] };
            expect(request).toEqual(expected);
            return {
              api: model.api,
              provider: model.provider,
              model: model.id,
              timestamp: 0,
              stopReason: "stop",
              answers: { clean: { type: "bool", probability: 0.9 } },
            };
          },
        },
      },
    });
    let execute: (() => Promise<unknown>) | undefined;
    typesafeQuestionExtension({
      registerTool(tool) {
        execute = async () => {
          const params: unknown = { ...input, includeAttachedImages: true };
          if (!Value.Check(tool.parameters, params)) throw new Error("Invalid fixture input");
          return tool.execute("attached-question", params, undefined, undefined, {
            modelRegistry: registry,
            sessionManager: { getBranch: () => [user([image])] },
          } as ExtensionToolContext);
        };
      },
    } as ExtensionAPI);
    if (!execute) throw new Error("Tool was not registered");
    expect(await execute()).toMatchObject({
      details: { answers: { clean: { type: "bool", probability: 0.9 } } },
    });
    expect(calls).toBe(1);
  } finally {
    if (previousDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDirectory;
    rmSync(directory, { recursive: true, force: true });
  }
});
