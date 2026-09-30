import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import typesafeQuestionExtension from "../index";

test("returns sanitized terminal tool errors with all billed classifier usage", async () => {
  const directory = mkdtempSync(join(tmpdir(), "classifier-accounting-"));
  const previousDirectory = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    const registry = await createNativeClassifierRegistry();
    let attempts = 0;
    const usage: Usage = {
      input: 17,
      output: 3,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 20,
      cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 },
    };
    registry.classify = async (model) => {
      attempts++;
      return {
        api: "typesafe-system-one",
        provider: model.provider,
        model: model.id,
        timestamp: 0,
        stopReason: "error",
        answers: {},
        usage,
        errorMessage: "secret billed provider response",
      };
    };
    let execute: (() => Promise<unknown>) | undefined;
    typesafeQuestionExtension({
      registerTool: (tool) => {
        execute = async () => {
          const params: unknown = {
            state: {},
            questions: {
              gate: {
                type: "bool",
                instructions: "Is this safe?",
                criteria: { true: "Safe", false: "Unsafe" },
              },
            },
          };
          if (!Value.Check(tool.parameters, params)) throw new Error("invalid test input");
          return tool.execute("failed-question", params, undefined, undefined, {
            modelRegistry: registry,
          } as ExtensionToolContext);
        };
      },
    } as ExtensionAPI);
    if (!execute) throw new Error("typesafe_question was not registered");
    const result = await execute();
    expect(attempts).toBe(2);
    expect(result).toMatchObject({
      isError: true,
      usage: { input: 34, output: 6, totalTokens: 40, cost: { total: 4 } },
      details: { answers: {}, failure: "Classifier request failed (auth: classifier-unavailable)" },
    });
    expect(JSON.stringify(result)).not.toContain("secret billed provider response");
  } finally {
    if (previousDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDirectory;
    rmSync(directory, { recursive: true, force: true });
  }
});
