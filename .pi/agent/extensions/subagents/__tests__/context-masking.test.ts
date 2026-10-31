import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import * as sdk from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { savedItems, saveMaskedTextArtifacts } from "../../context-masking/evidence-archive";
import { MARKER } from "../../context-masking/policy";
import { capabilityCatalog } from "../catalog";
import { CHILD_PROTOCOL_TOOLS, createChildSession } from "../child-session";
import type { ResolvedSpecialist } from "../specialist";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(enabled = true, rollingEnabled = false) {
  const root = await mkdtemp(join(tmpdir(), "child-context-masking-"));
  await mkdir(join(root, "instructions"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  cleanups.push(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  });
  await writeFile(
    join(root, "settings.json"),
    JSON.stringify({
      classifier: { enabled: false },
      contextClassifierCompaction: { enabled: false },
      contextMasking: { enabled, rollingEnabled, protectRecentTurns: 1 },
    }),
  );
  const models = await sdk.ModelRuntime.create({
    authPath: join(root, "auth.json"),
    modelsPath: join(root, "models.json"),
    modelsStorePath: join(root, "models-store.json"),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const model = models.getModels()[0];
  if (!model) throw Error("Fixture needs the installed static model catalog");
  const config: ResolvedSpecialist = {
    name: "fixture",
    description: "Masking fixture",
    prompt: "Inspect local evidence.",
    model: `${model.provider}/${model.id}`,
    maxTurns: 12,
    tools: ["read"],
    excludeTools: ["subagent", "subagent_result", "subagent_control"],
    extensions: capabilityCatalog(resolve(import.meta.dir, "../../.."), new Map(), new Set())
      .baseline.extensions,
    skills: [],
  };
  const start = async () => {
    const child = await createChildSession({
      config,
      cwd: root,
      agentDir: root,
      model,
      sdk,
      protocol(pi) {
        for (const name of CHILD_PROTOCOL_TOOLS)
          pi.registerTool({
            name,
            label: name,
            description: name,
            parameters: Type.Object({}),
            async execute() {
              return { content: [{ type: "text", text: "Fixture" }], details: undefined };
            },
          });
      },
      onUncertainStartup(error) {
        throw error;
      },
    });
    cleanups.push(child.close);
    const usage = spyOn(child.session, "getContextUsage").mockReturnValue({
      tokens: 80_000,
      contextWindow: 100_000,
      percent: 80,
    });
    cleanups.push(async () => {
      usage.mockRestore();
    });
    return { ...child, usage };
  };
  return { root, start };
}

function appendTurn(manager: sdk.SessionManager, text: string, callId: string) {
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "toolCall", id: callId, name: "read", arguments: { path: "fixture.txt" } }],
    api: "openai-responses",
    provider: "fixture",
    model: "fixture",
    stopReason: "toolUse",
    timestamp: 0,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
  const messageEntryId = manager.appendMessage(message);
  const toolResult = {
    role: "toolResult" as const,
    toolCallId: callId,
    toolName: "read",
    content: [{ type: "text" as const, text }],
    isError: false,
    timestamp: 0,
  };
  const resultId = manager.appendMessage(toolResult);
  return { message, messageEntryId, resultId, toolResult };
}

function appendDraft(manager: sdk.SessionManager, draft: sdk.SessionBoundaryDraft) {
  if (draft.type === "context_edit") manager.appendContextEdit(draft.targetId, draft.replacement);
  else if (draft.type === "custom") manager.appendCustomEntry(draft.customType, draft.data);
  else throw Error(`Unexpected masking draft: ${draft.type}`);
}

async function boundary(child: Awaited<ReturnType<typeof createChildSession>>) {
  const manager = child.session.sessionManager;
  const old = appendTurn(manager, "workerreceipt: preserve æøå\n".repeat(5_000), "old");
  const tail = appendTurn(manager, "Recent output", "tail");
  const result = await child.session.extensionRunner.emitBoundary(
    {
      type: "turn_end",
      turnIndex: 1,
      outcome: "completed",
      message: tail.message,
      messageEntryId: tail.messageEntryId,
      toolResults: [tail.toolResult],
      toolResultEntryIds: [tail.resultId],
    },
    (entries) => {
      const header = manager.getHeader();
      if (!header) throw Error("Missing child session header");
      const preview = sdk.SessionManager.inMemory(manager.getCwd(), undefined, [
        header,
        ...manager.getBranch(),
      ]);
      for (const entry of entries) appendDraft(preview, entry);
      const projection = preview.buildSessionProjection();
      return {
        contextEntries: projection.entries,
        contextMessages: projection.messages,
        llmMessages: sdk.convertToLlm(projection.messages),
        pendingMessages: [],
        canContinue: false,
      };
    },
  );
  expect(result.valid).toBe(true);
  return { old, result };
}

test.each([false, true])(
  "the mandatory child baseline masks its own outputs and activates branch-scoped recall (rolling=%s)",
  async (rolling) => {
    const f = await fixture(true, rolling);
    const child = await f.start();
    const manager = child.session.sessionManager;
    expect(child.session.getAllTools().find((tool) => tool.name === "recall")?.exposure).toBe(
      "deferred",
    );
    expect(child.session.getActiveToolNames()).not.toContain("recall");

    const parent = sdk.SessionManager.inMemory(f.root);
    const parentText = "parentreceipt: private parent evidence";
    const parentTurn = appendTurn(parent, parentText, "parent");
    const parentCandidate = { entryId: parentTurn.resultId, toolName: "read", text: parentText };
    const [parentSaved] = await saveMaskedTextArtifacts(
      join(f.root, "cache/context-masking"),
      parent.getSessionId(),
      [parentCandidate],
    );
    if (!parentSaved) throw Error("Parent archive missing");
    parent.appendCustomEntry("context-masking", {
      items: [{ ...parentCandidate, path: parentSaved.path }],
    });

    const { old, result } = await boundary(child);
    const edits = result.entries.filter((entry) => entry.type === "context_edit");
    expect(edits.map((edit) => edit.targetId)).toEqual([old.resultId]);
    expect(child.session.getActiveToolNames()).not.toContain("recall");
    for (const entry of result.entries) appendDraft(manager, entry);
    const saved = savedItems(manager.getBranch()).get(old.resultId);
    if (!saved) throw Error("Child archive missing");
    const path = saved.path;
    expect(path.startsWith(join(f.root, "cache/context-masking", manager.getSessionId()))).toBe(
      true,
    );
    expect(await readFile(path, "utf8")).toContain("workerreceipt: preserve æøå");
    const projected = manager.buildSessionProjection();
    expect(JSON.stringify(projected.messages)).toContain(MARKER);
    await child.session.extensionRunner.emitContext(projected.messages);
    expect(child.session.getActiveToolNames()).toContain("recall");
    expect(child.session.systemPrompt).toContain(
      "Use recall before answering questions that depend on masked earlier output",
    );
    const recall = child.session.agent.state.tools.find((tool) => tool.name === "recall");
    if (!recall) throw Error("Recall was not activated");
    const recalled = await recall.execute("own-recall", { query: "workerreceipt" });
    expect(JSON.stringify(recalled.content)).toContain("workerreceipt: preserve æøå");
    const missing = await recall.execute("parent-recall", { query: "parentreceipt" });
    expect(JSON.stringify(missing.content)).not.toContain("private parent evidence");
    const sibling = await f.start();
    await sibling.session.extensionRunner.emitContext(
      sibling.session.sessionManager.buildSessionProjection().messages,
    );
    expect(sibling.session.getActiveToolNames()).not.toContain("recall");
    expect(sibling.session.sessionManager.getSessionId()).not.toBe(manager.getSessionId());
    expect(child.errors).toEqual([]);
    expect(sibling.errors).toEqual([]);
  },
);

test.each([false, true])(
  "child masking respects global enablement and context pressure (enabled=%s)",
  async (enabled) => {
    const f = await fixture(enabled);
    const child = await f.start();
    if (enabled)
      child.usage.mockReturnValue({ tokens: 10_000, contextWindow: 100_000, percent: 10 });
    const { result } = await boundary(child);
    expect(result.entries).toEqual([]);
    await child.session.extensionRunner.emitContext(
      child.session.sessionManager.buildSessionProjection().messages,
    );
    expect(child.session.getActiveToolNames()).not.toContain("recall");
    expect(child.errors).toEqual([]);
  },
);
