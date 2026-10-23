import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createChildSession } from "../child-session";
import { PiChildDriver } from "../driver";
import type { ChildDriverCallbacks, ChildRunInput } from "../owner";

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

type Response = Pick<AssistantMessage, "content"> & { stopReason: "toolUse" | "stop" };
type Checkpoint = (toolResultCount: number, trace: string[]) => Promise<void>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(onCheckpoint: Checkpoint) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-budget-admission-"));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));

  const trace: string[] = [];
  const requests: string[] = [];
  const updates: string[] = [];
  let providerCalls = 0;
  const program = (call: number): Response =>
    call === 1
      ? {
          content: [
            {
              type: "toolCall",
              id: "admission-update",
              name: "worker_update",
              arguments: { text: "Checkpoint witness" },
            },
          ],
          stopReason: "toolUse",
        }
      : { content: [{ type: "text", text: "Admission complete" }], stopReason: "stop" };

  const driver = new PiChildDriver({
    cwd,
    agentDir: cwd,
    projectTrusted: false,
    resolveModel: () => model,
    retainUncertain: () => {},
    shutdownGraceMs: 5_000,
    create: async (options) => {
      const child = await createChildSession({
        ...options,
        sdk,
        protocol: async (pi) => {
          await options.protocol(pi);
          pi.on("turn_end", async (event) => {
            if (event.message.role !== "assistant" || event.message.stopReason !== "toolUse")
              return;
            trace.push(`checkpoint:turn_end:${event.toolResults.length}`);
            await onCheckpoint(event.toolResults.length, trace);
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
              const call = ++providerCalls;
              trace.push(`provider:${call}`);
              requests.push(JSON.stringify(context.messages));
              const response = program(call);
              const message: AssistantMessage = {
                ...response,
                role: "assistant",
                api: selected.api,
                provider: selected.provider,
                model: selected.id,
                timestamp: Date.now(),
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
              stream.push({ type: "done", reason: response.stopReason, message });
              return stream;
            },
          });
        },
      });
      return child;
    },
  });

  const input: ChildRunInput = {
    parentSessionId: "parent",
    workerId: "worker",
    assignmentId: "assignment",
    specialist: "fixture",
    config: {
      name: "fixture",
      description: "Admission boundary fixture",
      prompt: "Return the result of this bounded fixture.",
      model: "fixture/fixture",
      maxTurns: 3,
      tools: ["read"],
      excludeTools: ["subagent", "mcp__*"],
      extensions: [],
      skills: [],
    },
    prompt: "Exercise one tool call, then finish.",
    turnsAlreadyUsed: 0,
    turnBudget: 3,
    wrapUpAtRemaining: 2,
  };
  const callbacks: ChildDriverCallbacks = {
    onQuestion: () => {},
    onUpdate: (text) => {
      updates.push(text);
      trace.push("tool:worker_update");
    },
    onTranscript: () => {},
    onTurn: () => {},
  };

  cleanups.push(async () => {
    await driver.close("worker");
  });
  return { driver, input, callbacks, requests, updates, trace, providerCalls: () => providerCalls };
}

async function flushSdkWork() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

test("turn_end admission waits before the next request without replaying the completed tool", async () => {
  const advisor = deferred<boolean>();
  const checkpointStarted = deferred<number>();
  const f = await fixture(async (toolResultCount, trace) => {
    trace.push("advisor:waiting");
    checkpointStarted.resolve(toolResultCount);
    const positive = await advisor.promise;
    trace.push(positive ? "advisor:positive" : "advisor:negative");
    if (positive) trace.push("admission:accepted");
  });
  cleanups.push(async () => advisor.resolve(false));

  const running = f.driver.start(f.input, f.callbacks);
  await checkpointStarted.promise;
  await flushSdkWork();

  expect(f.trace).toEqual([
    "provider:1",
    "tool:worker_update",
    "checkpoint:turn_end:1",
    "advisor:waiting",
  ]);
  expect(f.providerCalls()).toBe(1);
  expect(f.requests).toHaveLength(1);

  advisor.resolve(true);
  expect(await running).toEqual({ kind: "completed", turnsUsed: 2, report: "Admission complete" });
  expect(f.trace).toEqual([
    "provider:1",
    "tool:worker_update",
    "checkpoint:turn_end:1",
    "advisor:waiting",
    "advisor:positive",
    "admission:accepted",
    "provider:2",
  ]);
  expect(f.providerCalls()).toBe(2);
  expect(f.updates).toEqual(["Checkpoint witness"]);
});

test("cancellation discards a late positive admission result before another request", async () => {
  const advisor = deferred<boolean>();
  const checkpointStarted = deferred<number>();
  let cancelled = false;
  const f = await fixture(async (toolResultCount, trace) => {
    trace.push("advisor:waiting");
    checkpointStarted.resolve(toolResultCount);
    const positive = await advisor.promise;
    trace.push(positive ? "advisor:positive" : "advisor:negative");
    if (cancelled) {
      trace.push("admission:discarded");
      return;
    }
    if (positive) trace.push("admission:accepted");
  });
  cleanups.push(async () => advisor.resolve(false));

  const running = f.driver.start(f.input, f.callbacks);
  await checkpointStarted.promise;
  await flushSdkWork();
  expect(f.providerCalls()).toBe(1);

  cancelled = true;
  f.trace.push("worker:cancelled");
  const aborting = f.driver.abort("worker");
  advisor.resolve(true);
  await aborting;

  expect((await running).kind).toBe("failed");
  expect(f.trace).toEqual([
    "provider:1",
    "tool:worker_update",
    "checkpoint:turn_end:1",
    "advisor:waiting",
    "worker:cancelled",
    "advisor:positive",
    "admission:discarded",
  ]);
  expect(f.providerCalls()).toBe(1);
  expect(f.requests).toHaveLength(1);
  expect(f.updates).toEqual(["Checkpoint witness"]);
});
