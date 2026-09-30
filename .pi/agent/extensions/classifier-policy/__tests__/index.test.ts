import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { createCodemodeExtension } from "@earendil-works/pi-coding-agent";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import typesafeQuestionExtension from "../../typesafe-question";
import classifierPolicyExtension from "../index";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("session gate protects explicit tools and native calls, refreshes cwd, and cleans up", async () => {
  const root = mkdtempSync(join(tmpdir(), "classifier-policy-extension-"));
  roots.push(root);
  const previousDirectory = process.env.PI_CODING_AGENT_DIR;
  const agentDirectory = join(root, "agent");
  const blockedCwd = join(root, "blocked");
  const allowedCwd = join(root, "allowed");
  mkdirSync(agentDirectory);
  mkdirSync(join(blockedCwd, ".pi"), { recursive: true });
  mkdirSync(allowedCwd);
  writeFileSync(join(agentDirectory, "settings.json"), "{}");
  writeFileSync(
    join(blockedCwd, ".pi", "settings.json"),
    JSON.stringify({ classifier: { enabled: false } }),
  );
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
  const tools: Parameters<ExtensionAPI["registerTool"]>[0][] = [];
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
      handlers.set(event, handler);
    },
    registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;
  const registry = await createNativeClassifierRegistry();
  const original = registry.classify;
  const context = (cwd: string) =>
    ({
      cwd,
      modelRegistry: registry,
      isProjectTrusted: () => true,
      tools: [],
      sessionManager: { getBranch: () => [] },
    }) as unknown as ExtensionToolContext;
  const input = {
    state: {},
    questions: {
      gate: {
        type: "bool" as const,
        instructions: "Check",
        criteria: { true: "Yes", false: "No" },
      },
    },
  };
  try {
    classifierPolicyExtension(pi);
    typesafeQuestionExtension(pi);
    createCodemodeExtension()(pi);
    handlers.get("session_start")?.({}, context(blockedCwd));
    const question = tools.find((tool) => tool.name === "typesafe_question");
    if (!question) throw new Error("Missing explicit question tool");
    const result = await question.execute("test", input, undefined, undefined, context(blockedCwd));
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "Classifier request failed (config: disabled)" },
    ]);
    const codemode = tools.find((tool) => tool.name === "codemode");
    if (!codemode) throw new Error("Missing native codemode tool");
    const script = await codemode.execute(
      "script",
      {
        code: `const model = await models.getModelOfType("classifier", "openrouter", "typesafe/jev-1.13"); return await models.classify(model, ${JSON.stringify(input)});`,
      },
      undefined,
      undefined,
      context(blockedCwd),
    );
    expect(JSON.stringify(script.content)).toContain("Classifier disabled by settings");
    expect(script.details).toMatchObject({ calls: [{ name: "models.classify", status: "error" }] });
    const model = registry.findOfType("classifier", "openrouter", "typesafe/jev-1.13");
    if (!model) throw new Error("Missing classifier fixture");
    let fetches = 0;
    const fetch = Object.assign(
      async () => {
        fetches++;
        return Response.json({
          answers: {
            gate: {
              type: "noul",
              noul: 0.9,
              trueProbability: 0.9,
              falseProbability: 0.1,
              confidence: 0.9,
            },
          },
        });
      },
      { preconnect: globalThis.fetch.preconnect },
    );
    expect((await registry.classify(model, input, { fetch })).stopReason).toBe("error");
    expect(fetches).toBe(0);
    handlers.get("before_agent_start")?.({}, context(allowedCwd));
    expect((await registry.classify(model, input, { fetch })).stopReason).toBe("stop");
    expect(fetches).toBe(1);
    handlers.get("tool_call")?.({}, context(blockedCwd));
    expect((await registry.classify(model, input, { fetch })).stopReason).toBe("error");
    expect(fetches).toBe(1);
  } finally {
    handlers.get("session_shutdown")?.({}, context(blockedCwd));
    expect(registry.classify).toBe(original);
    if (previousDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDirectory;
  }
});
