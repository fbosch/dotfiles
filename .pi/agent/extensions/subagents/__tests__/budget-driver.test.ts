import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { BudgetAdviceInput } from "../budget";
import { createChildSession } from "../child-session";
import { PiChildDriver } from "../driver";
import { WorkerOwner, type WorkerOwnerOptions } from "../owner";

const sdk: typeof import("@earendil-works/pi-coding-agent") = await import(
  process.env.PI_SUBAGENT_TEST_SDK ?? "@earendil-works/pi-coding-agent"
);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const model: NonNullable<ExtensionContext["model"]> = {
  id: "fixture",
  name: "Fixture",
  provider: "fixture",
  api: "openai-completions",
  baseUrl: "https://fixture.invalid",
  reasoning: false,
  input: ["text"],
  contextWindow: 32_000,
  maxTokens: 1_000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const privateEvidence = "PRIVATE_TOOL_BODY_AND_PROMPT_CANARY";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(
  options: {
    budget?: WorkerOwnerOptions["budget"];
    hardMaxTurns?: number;
    finalAt?: number;
    questionAt?: number;
    failAt?: number;
  } = {},
) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-budget-driver-"));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  let providerCalls = 0;
  const completedTools: string[] = [];
  const adviceInputs: BudgetAdviceInput[] = [];
  const updates: string[] = [];
  const turns: Array<{ used: number; remaining: number }> = [];
  const config = {
    name: "fixture",
    description: "Integrated budget fixture",
    prompt: privateEvidence,
    model: "fixture/fixture",
    maxTurns: 16,
    hardMaxTurns: options.hardMaxTurns ?? 32,
    tools: ["read"],
    excludeTools: ["subagent", "mcp__*"],
    extensions: [],
    skills: [],
  };
  const driver = new PiChildDriver({
    cwd,
    agentDir: cwd,
    projectTrusted: false,
    resolveModel: () => model,
    retainUncertain: () => {},
    shutdownGraceMs: 5_000,
    create: (input) =>
      createChildSession({
        ...input,
        sdk,
        protocol: async (pi) => {
          await input.protocol(pi);
          pi.registerTool({
            name: "read",
            label: "Fixture read",
            description: "Return a structured fixture outcome.",
            parameters: Type.Object({ path: Type.String() }),
            outputSchema: Type.Object({ kind: Type.Literal("read"), ok: Type.Literal(true) }),
            async execute(id) {
              completedTools.push(id);
              return {
                content: [{ type: "text", text: privateEvidence }],
                structuredContent: { kind: "read", ok: true },
                details: { marker: privateEvidence },
              };
            },
          });
          pi.registerProvider("fixture", {
            api: "openai-completions",
            baseUrl: "https://fixture.invalid",
            apiKey: "fixture-not-a-real-key",
            models: [
              {
                id: "fixture",
                name: "Fixture",
                input: ["text"],
                reasoning: false,
                contextWindow: 32_000,
                maxTokens: 1_000,
                cost: model.cost,
              },
            ],
            streamSimple(selected) {
              const call = ++providerCalls;
              const stopReason =
                call === options.failAt ? "error" : call === options.finalAt ? "stop" : "toolUse";
              const content: AssistantMessage["content"] =
                stopReason === "toolUse"
                  ? [
                      {
                        type: "toolCall",
                        id: `fixture-${call}`,
                        name: call === options.questionAt ? "worker_question" : "read",
                        arguments:
                          call === options.questionAt
                            ? { question: "Fixture input?" }
                            : { path: privateEvidence },
                      },
                    ]
                  : [{ type: "text", text: "Fixture handoff" }];
              const message: AssistantMessage = {
                role: "assistant",
                content,
                stopReason,
                api: selected.api,
                provider: selected.provider,
                model: selected.id,
                timestamp: Date.now(),
                ...(stopReason === "error" ? { errorMessage: "Fixture provider failure" } : {}),
                usage: {
                  input: 1,
                  output: 1,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 2,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
              };
              const stream = createAssistantMessageEventStream();
              stream.push({ type: "start", partial: message });
              if (stopReason === "error")
                stream.push({ type: "error", reason: "error", error: message });
              else stream.push({ type: "done", reason: stopReason, message });
              return stream;
            },
          });
        },
      }),
  });
  const budget = options.budget ?? {
    mode: "automatic",
    confidenceThreshold: 0.8,
    advisor: async (input: BudgetAdviceInput) => {
      adviceInputs.push(input);
      return { kind: "judgment", probability: 1 };
    },
  };
  let cleanupUncertain = false;
  const owner = new WorkerOwner({
    parentSessionId: "parent",
    driver,
    capacity: 1,
    budget,
    persistence: { async save() {} },
    cleanupHealth: {
      isBlocked: () => cleanupUncertain,
      markUncertain: () => {
        cleanupUncertain = true;
      },
    },
  });
  cleanups.push(async () => {
    await owner.shutdown();
    expect(cleanupUncertain).toBe(false);
  });
  owner.subscribe((event) => {
    if (event.type === "update") updates.push(event.text);
    if (event.type === "turn")
      turns.push({ used: event.turnsUsed, remaining: event.remainingTurns });
  });
  const receipt = await owner.launch({ config, prompt: privateEvidence, maxTurns: 16 });
  const snapshot = () => {
    const assignment = owner.inspect(receipt.workerId).assignments[0];
    if (!assignment) throw new Error("Expected fixture assignment");
    return assignment;
  };
  const wait = () => owner.wait(receipt.workerId, receipt.assignmentId);
  return {
    owner,
    receipt,
    snapshot,
    wait,
    completedTools,
    adviceInputs,
    updates,
    turns,
    providerCalls: () => providerCalls,
  };
}

test("production driver applies 16 to 20 to 24 without a third grant or tool replay", async () => {
  const f = await fixture({ finalAt: 25 });
  expect((await f.wait()).kind).toBe("budget-exhausted");
  expect(f.providerCalls()).toBe(24);
  expect(f.completedTools).toHaveLength(24);
  expect(new Set(f.completedTools).size).toBe(24);
  expect(f.snapshot()).toMatchObject({
    turnsUsed: 24,
    maxTurns: 24,
    budget: { initialTurns: 16, grantedTurns: 24, hardMaxTurns: 32, checks: 2, automaticGrants: 2 },
  });
  expect(f.turns.find((turn) => turn.used === 15)).toEqual({ used: 15, remaining: 5 });
  expect(f.turns.find((turn) => turn.used === 19)).toEqual({ used: 19, remaining: 5 });
  expect(f.updates).toHaveLength(2);
  expect(f.updates[0]).toContain("allowance 20, ceiling 32");
  expect(f.updates[1]).toContain("allowance 24, ceiling 32");
  expect(f.adviceInputs.map((input) => input.progress.verifiedSuccesses)).toEqual([14, 18]);
  expect(f.adviceInputs.map((input) => input.turnsUsed)).toEqual([14, 18]);
  expect(f.snapshot().budget?.decisions.map((decision) => decision.turnsUsed)).toEqual([14, 18]);
  expect(JSON.stringify(f.adviceInputs)).not.toContain(privateEvidence);
  const toolMessages = f.snapshot().transcript.filter((entry) => entry.role === "tool");
  expect(toolMessages).toHaveLength(24);
  expect(
    toolMessages.every((entry) => JSON.parse(entry.text).details.marker === privateEvidence),
  ).toBe(true);
});

test("production driver clamps a final grant and permits a genuine final handoff", async () => {
  const f = await fixture({ hardMaxTurns: 22, finalAt: 22 });
  expect((await f.wait()).kind).toBe("completed");
  expect(f.providerCalls()).toBe(22);
  expect(f.snapshot()).toMatchObject({
    turnsUsed: 22,
    maxTurns: 22,
    report: "Fixture handoff",
    budget: { automaticGrants: 2, checks: 2, hardMaxTurns: 22 },
  });
  expect(f.updates[1]).toContain("Granted 2 additional turns; allowance 22, ceiling 22");
});

test("production driver keeps missing, unavailable, and advisory setup non-granting", async () => {
  for (const budget of [
    { mode: "fixed" },
    { mode: "advisory", advisor: async () => ({ kind: "judgment", probability: 1 }) },
    {
      mode: "automatic",
      confidenceThreshold: 0.8,
      advisor: async () => ({ kind: "unavailable", reason: "auth-failure", diagnostic: true }),
    },
  ] satisfies Array<NonNullable<WorkerOwnerOptions["budget"]>>) {
    const f = await fixture({ budget, finalAt: 17 });
    expect((await f.wait()).kind).toBe("budget-exhausted");
    expect(f.providerCalls()).toBe(16);
    expect(f.snapshot().maxTurns).toBe(16);
    expect(f.snapshot().budget?.automaticGrants).toBe(0);
  }
});

test("production admission preserves a question's assignment and consumed budget", async () => {
  const f = await fixture({ questionAt: 14, finalAt: 17 });
  expect((await f.wait()).kind).toBe("question");
  expect(f.providerCalls()).toBe(14);
  expect(f.snapshot()).toMatchObject({ turnsUsed: 14, maxTurns: 16, budget: { checks: 0 } });
  const pending = f.owner.inspect(f.receipt.workerId).pendingQuestion;
  if (!pending) throw new Error("Expected correlated fixture question");
  await f.owner.reply(f.receipt.workerId, pending.id, "Fixture answer");
  expect((await f.wait()).kind).toBe("completed");
  expect(f.providerCalls()).toBe(17);
  expect(f.snapshot()).toMatchObject({
    id: f.receipt.assignmentId,
    turnsUsed: 17,
    maxTurns: 20,
    budget: { initialTurns: 16, checks: 1, automaticGrants: 1 },
  });
});

test("production cancellation settles a pending gate and discards its late positive result", async () => {
  const started = deferred<void>();
  const late = deferred<{ kind: "judgment"; probability: number }>();
  const f = await fixture({
    budget: {
      mode: "automatic",
      confidenceThreshold: 0.8,
      advisor: async () => {
        started.resolve();
        return late.promise;
      },
    },
  });
  await started.promise;
  expect(f.providerCalls()).toBe(14);
  expect(f.completedTools).toHaveLength(14);
  await f.owner.cancel(f.receipt.workerId);
  late.resolve({ kind: "judgment", probability: 1 });
  await f.wait();
  expect(f.owner.inspect(f.receipt.workerId).status).toBe("cancelled");
  expect(f.providerCalls()).toBe(14);
  expect(f.snapshot()).toMatchObject({
    turnsUsed: 14,
    maxTurns: 16,
    budget: { checks: 1, automaticGrants: 0, decisions: [] },
  });
  expect(f.updates).toEqual([]);
});

test("production provider failures retain evidence without hidden retries", async () => {
  const f = await fixture({ failAt: 16 });
  expect((await f.wait()).kind).toBe("failed");
  expect(f.providerCalls()).toBe(16);
  expect(f.snapshot()).toMatchObject({
    turnsUsed: 16,
    maxTurns: 20,
    partialReport: "Fixture handoff",
  });
  expect(f.completedTools).toHaveLength(15);
  expect(
    f.snapshot().transcript.some((entry) => entry.text.includes("Fixture provider failure")),
  ).toBe(true);
});
