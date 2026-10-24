import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createChildSession } from "../child-session";
import { PiChildDriver, runtimeModelDetails } from "../driver";
import { processCleanupHealth } from "../health";
import {
  type ChildDriverCallbacks,
  type ChildRunInput,
  type TranscriptEntry,
  WorkerOwner,
} from "../owner";

const sdk: typeof import("@earendil-works/pi-coding-agent") = await import(
  process.env.PI_SUBAGENT_TEST_SDK ?? "@earendil-works/pi-coding-agent"
);

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
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

type Response = Pick<AssistantMessage, "content" | "stopReason">;
async function fixture(
  program: (call: number) => Response,
  extra?: ExtensionFactory,
  virtual = false,
) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-driver-"));
  cleanup.push(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "baseline.ts"), "export default function () {}\n");
  let calls = 0;
  let commandCalls = 0;
  const requests: string[] = [];
  const retained: unknown[] = [];
  const handles: Array<Awaited<ReturnType<typeof createChildSession>>> = [];
  const driver = new PiChildDriver({
    cwd,
    agentDir: cwd,
    projectTrusted: false,
    resolveModel: () =>
      virtual
        ? { ...model, api: "pi-virtual", provider: "router", id: "auto", reasoning: true }
        : model,
    retainUncertain: (_id, resources) => {
      retained.push(resources);
    },
    shutdownGraceMs: 20,
    create: (options) =>
      createChildSession({
        ...options,
        sdk,
        protocol: async (pi) => {
          await options.protocol(pi);
          await extra?.(pi);
          if (virtual)
            pi.registerVirtualModel({
              provider: "router",
              id: "auto",
              name: "Auto",
              thinkingLevels: ["high"],
              route: (_request, ctx) => ({
                model: ctx.modelRegistry.find("fixture", "fixture")!,
                thinkingLevel: "low",
              }),
            });
          pi.registerCommand("tripwire", {
            description: "Must not run as an assignment",
            handler: async () => {
              commandCalls++;
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
            streamSimple(selected, context) {
              requests.push(JSON.stringify(context.messages));
              const response = program(++calls);
              const message: AssistantMessage = {
                ...response,
                role: "assistant",
                api: selected.api,
                provider: selected.provider,
                model: selected.id,
                timestamp: Date.now(),
                usage: {
                  input: 1,
                  output: 2,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 3,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
              };
              const stream = createAssistantMessageEventStream();
              stream.push({ type: "start", partial: message });
              if (message.stopReason === "error" || message.stopReason === "aborted")
                stream.push({ type: "error", reason: message.stopReason, error: message });
              else if (message.stopReason === "pending")
                throw new Error("Fixture cannot emit a pending final message");
              else stream.push({ type: "done", reason: message.stopReason, message });
              return stream;
            },
          });
        },
      }).then((child) => {
        handles.push(child);
        return child;
      }),
  });
  const input: ChildRunInput = {
    parentSessionId: "parent",
    workerId: "worker",
    assignmentId: "assignment",
    specialist: "fixture",
    config: {
      name: "fixture",
      description: "Fixture",
      prompt: "Bounded fixture",
      model: virtual ? "router/auto" : "fixture/fixture",
      ...(virtual ? { thinking: "high" as const } : {}),
      maxTurns: 3,
      tools: ["read"],
      excludeTools: ["subagent", "mcp__*"],
      extensions: [join(cwd, "baseline.ts")],
      skills: [],
    },
    prompt: "fixture assignment",
    turnsAlreadyUsed: 0,
    turnBudget: 3,
    wrapUpAtRemaining: 2,
  };
  const transcript: Array<Omit<TranscriptEntry, "timestamp"> & { timestamp?: number }> = [];
  const questions: string[] = [];
  const turns: number[] = [];
  const updates: string[] = [];
  const callbacks: ChildDriverCallbacks = {
    onQuestion: (text) => {
      questions.push(text);
    },
    onUpdate: (text) => {
      updates.push(text);
    },
    onTranscript: (entry) => {
      transcript.push(entry);
    },
    onTurn: (used) => {
      turns.push(used);
    },
  };
  cleanup.push(async () => {
    await driver.close("worker");
  });
  return {
    driver,
    input,
    callbacks,
    transcript,
    questions,
    turns,
    updates,
    requests,
    retained,
    handles,
    calls: () => calls,
    commandCalls: () => commandCalls,
  };
}

const answer = (text: string): Response => ({
  content: [{ type: "text", text }],
  stopReason: "stop",
});
const question = (): Response => ({
  content: [
    {
      type: "toolCall",
      id: "question",
      name: "worker_question",
      arguments: { question: "Which target?" },
    },
  ],
  stopReason: "toolUse",
});

test("real Pi execution returns the full report and treats slash-command assignments as text", async () => {
  const report = "long evidence ".repeat(8_000) + "FINAL_CAVEAT";
  const f = await fixture(() => answer(report));
  const result = await f.driver.start({ ...f.input, prompt: "/tripwire" }, f.callbacks);
  expect(result).toEqual({ kind: "completed", turnsUsed: 1, report });
  expect(f.commandCalls()).toBe(0);
  expect(f.requests[0]).toContain("/tripwire");
  expect(
    f.transcript.some((entry) => entry.role === "assistant" && entry.text.includes("FINAL_CAVEAT")),
  ).toBe(true);
  expect(f.driver.observation("worker")?.outputTokens).toBe(2);
  expect(f.driver.observation("worker")?.resolvedModel).toBe("fixture/fixture");
  expect(f.driver.observation("worker")?.resolvedThinking).toBe(
    f.handles[0]!.session.thinkingLevel,
  );
});

test("skipped skill warning is retained in parent transcript without altering report", async () => {
  const f = await fixture(() => answer("Full report"));
  const input = { ...f.input, config: { ...f.input.config, skippedSkills: ["absent"] } };
  expect(await f.driver.start(input, f.callbacks)).toMatchObject({
    kind: "completed",
    report: "Full report",
  });
  expect(f.transcript).toContainEqual({
    role: "system",
    text: "Skipped unavailable skills: absent",
  });
  expect(f.handles[0]!.session.systemPrompt).toContain("Skipped unavailable skills: absent");
});
test("virtual model metadata uses the runtime route rather than the alias thinking level", () => {
  const selected = { ...model, provider: "presets", id: "routine", api: "pi-virtual" };
  expect(
    runtimeModelDetails({
      model: selected,
      thinkingLevel: "high",
      routedModel: { model, thinkingLevel: "low" },
    }),
  ).toEqual({ resolvedModel: "fixture/fixture", resolvedThinking: "low" });
  expect(
    runtimeModelDetails({ model: selected, thinkingLevel: "high", routedModel: undefined }),
  ).toEqual({ resolvedModel: undefined, resolvedThinking: undefined });
  expect(
    runtimeModelDetails({ model: selected, thinkingLevel: "high", routedModel: { model } })
      .resolvedThinking,
  ).toBeUndefined();
});

test("a real virtual child records the physical response and its clamped thinking level", async () => {
  const f = await fixture(() => answer("Routed response"), undefined, true);
  expect(await f.driver.start(f.input, f.callbacks)).toMatchObject({
    kind: "completed",
    report: "Routed response",
  });
  expect(f.handles[0]!.session.model?.provider).toBe("router");
  expect(f.driver.observation("worker")).toMatchObject({
    resolvedModel: "fixture/fixture",
    resolvedThinking: "off",
  });
});

test("turn budget stops real repeated tool execution and injects the two-turn warning", async () => {
  const f = await fixture((call) => ({
    content: [
      {
        type: "toolCall",
        id: `update-${call}`,
        name: "worker_update",
        arguments: { text: "material fixture finding" },
      },
    ],
    stopReason: "toolUse",
  }));
  const result = await f.driver.start(f.input, f.callbacks);
  expect(result.kind).toBe("budget-exhausted");
  expect(result.turnsUsed).toBe(3);
  expect(f.calls()).toBe(3);
  expect(f.turns).toEqual([1, 2, 3]);
  expect(f.requests[1]).toContain("2 turn(s) remain");
});

test("question yields a settled Pi session and reply preserves the assignment budget", async () => {
  const f = await fixture((call) => (call === 1 ? question() : answer("Use chosen target")));
  const first = await f.driver.start(f.input, f.callbacks);
  expect(first).toEqual({ kind: "waiting-question", turnsUsed: 1 });
  expect(f.questions).toEqual(["Which target?"]);
  const second = await f.driver.prompt(
    {
      ...f.input,
      prompt: "Use target A",
      purpose: "question-reply",
      questionId: "correlated-by-owner",
      turnsAlreadyUsed: 1,
      turnBudget: 2,
    },
    f.callbacks,
  );
  expect(second).toEqual({ kind: "completed", turnsUsed: 2, report: "Use chosen target" });
  expect(f.requests[1]).toContain("Use target A");
  expect(f.turns).toEqual([1, 2]);
});

test("shutdown handler failure reports uncertainty rather than releasing the child", async () => {
  const f = await fixture(
    () => answer("done"),
    (pi) => {
      pi.on("session_shutdown", () => {
        throw new Error("fixture shutdown failed");
      });
    },
  );
  await f.driver.start(f.input, f.callbacks);
  const result = await f.driver.close("worker");
  expect(result.confirmed).toBe(false);
  expect(result.diagnostic).toContain("fixture shutdown failed");
  expect(f.retained.length).toBeGreaterThan(0);
});

test("a real child with a non-cooperative tool retains cleanup uncertainty after abort times out", async () => {
  let entered = () => {};
  let release = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(
    () => ({
      content: [{ type: "toolCall", id: "linger", name: "linger", arguments: {} }],
      stopReason: "toolUse",
    }),
    (pi) => {
      pi.registerTool({
        name: "linger",
        label: "Fixture wait",
        description: "Controlled non-cooperative tool",
        parameters: Type.Object({}),
        async execute() {
          entered();
          // Deliberately ignore cancellation until the test releases this tool.
          await gate;
          return { content: [{ type: "text", text: "Fixture released" }], details: undefined };
        },
      });
    },
  );
  const health = processCleanupHealth({});
  const owner = new WorkerOwner({
    parentSessionId: "parent",
    driver: f.driver,
    persistence: { async save() {} },
    cleanupHealth: health,
  });
  cleanup.push(async () => {
    release();
    for (const handle of f.handles) await handle.close();
    await owner.shutdown();
  });
  const config = { ...f.input.config, tools: [...f.input.config.tools, "linger"] };
  const launched = await owner.launch({ config, prompt: "Wait inside the controlled tool" });
  await started;
  expect((await owner.cancel(launched.workerId)).status).toBe("stopping");
  const outcome = await owner.wait(launched.workerId, launched.assignmentId);
  expect(outcome.kind).toBe("cleanup-unknown");
  expect(health.isBlocked()).toBe(true);
  expect(f.retained.length).toBeGreaterThan(0);
  expect((await f.driver.close(launched.workerId)).confirmed).toBe(false);
  await expect(owner.launch({ config, prompt: "Must not start" })).rejects.toThrow(
    "cleanup uncertainty",
  );
  release();
  await f.handles[0]!.session.agent.waitForIdle();
  expect(owner.inspect(launched.workerId).status).toBe("cleanup-unknown");
  expect(health.isBlocked()).toBe(true);
  expect(f.calls()).toBe(1);
});
