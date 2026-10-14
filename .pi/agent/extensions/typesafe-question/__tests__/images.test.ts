import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierApi, ClassifierModel } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import { classifyQuestion, normalizeQuestionInput, QuestionParameters } from "../index";

const image = { type: "image" as const, data: "AAAA", mimeType: "image/png" };
const input = {
  state: { task: "Check screenshot" },
  images: [image],
  questions: {
    clean: {
      type: "bool" as const,
      instructions: "Is the screenshot readable?",
      criteria: { true: "Readable", false: "Not readable" },
    },
  },
};
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "question-images-"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

test("typesafe_question exposes image blocks and forwards them to the native image route", async () => {
  expect(Value.Check(QuestionParameters, input)).toBe(true);
  expect(normalizeQuestionInput(input)).toEqual(input);
  const native = await createNativeClassifierRegistry();
  const template = native.findOfType("classifier", "openrouter", "typesafe/jev-1.13");
  if (!template) throw new Error("Missing Jev fixture");
  const model: ClassifierModel<ClassifierApi> = {
    ...template,
    provider: "openrouter",
    id: "openai/gpt-6-luna-decisions",
    api: "fixture-vision",
    input: ["text", "image"],
  };
  let calls = 0;
  const result = await classifyQuestion(
    input,
    {
      findOfType: (_type, provider, id) => {
        expect([provider, id]).toEqual(["openrouter", "openai/gpt-6-luna-decisions"]);
        return model;
      },
      classify: async (selected, request) => {
        calls++;
        expect(request).toEqual(input);
        return {
          api: selected.api,
          provider: selected.provider,
          model: selected.id,
          timestamp: 0,
          stopReason: "stop",
          answers: { clean: { type: "bool", probability: 0.8 } },
        };
      },
    },
    { agentDirectory: directory },
  );
  expect(calls).toBe(1);
  expect(result).toEqual({ answers: { clean: { type: "bool", probability: 0.8 } } });
});

test("large valid image blocks do not consume the 64 KB JSON state budget", () => {
  const request = {
    ...input,
    images: [{ ...image, data: Buffer.alloc(75_000).toString("base64") }],
  };
  expect(normalizeQuestionInput(request)).toEqual(request);
});

test("malformed image inputs fail before any model lookup or classification", async () => {
  let calls = 0;
  const registry = {
    findOfType: () => {
      calls++;
      return undefined;
    },
    classify: async () => {
      calls++;
      throw new Error("unexpected request");
    },
  };
  for (const images of [
    [{ ...image, data: "invalid" }],
    [{ ...image, type: "text" }],
    [{ ...image, mimeType: "text/html" }],
    [{ ...image, extra: "not allowed" }],
    Array.from({ length: 5 }, () => image),
  ])
    await expect(
      classifyQuestion({ ...input, images }, registry, { agentDirectory: directory }),
    ).rejects.toThrow();
  expect(calls).toBe(0);
});

test("unavailable image classifiers produce a sanitized error without a Jev request", async () => {
  let calls = 0;
  const native = await createNativeClassifierRegistry();
  await expect(
    classifyQuestion(
      input,
      {
        findOfType: native.findOfType.bind(native),
        classify: async () => {
          calls++;
          throw new Error("must not classify images with Jev");
        },
      },
      { agentDirectory: directory },
    ),
  ).rejects.toThrow("classifier-unavailable");
  expect(calls).toBe(0);
});
