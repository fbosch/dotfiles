import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface Rendezvous {
  promise: Promise<void>;
  resolve: () => void;
}
interface FixtureState {
  ready: Rendezvous;
  released: Rendezvous;
  parallel: Rendezvous;
  arrivals: Map<string, string>;
  child?: string;
}
const shared = globalThis as typeof globalThis & {
  __orchestrationFixtures?: Map<string, FixtureState>;
};
shared.__orchestrationFixtures ??= new Map();
const states = shared.__orchestrationFixtures;
const rendezvous = (): Rendezvous => {
  const pending = Promise.withResolvers<void>();
  return { promise: pending.promise, resolve: pending.resolve };
};
function stateFor(trace: string): FixtureState {
  let state = states.get(trace);
  if (!state) {
    state = {
      ready: rendezvous(),
      released: rendezvous(),
      parallel: rendezvous(),
      arrivals: new Map(),
    };
    states.set(trace, state);
  }
  return state;
}
async function wait(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  const timeout = AbortSignal.timeout(90_000);
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
  combined.throwIfAborted();
  await new Promise<void>((done, fail) => {
    const abort = () => fail(new Error("Fixture barrier cancelled or timed out"));
    combined.addEventListener("abort", abort, { once: true });
    promise.then(done, fail).finally(() => combined.removeEventListener("abort", abort));
  });
}

export default function orchestrationFixture(pi: ExtensionAPI): void {
  const trace = process.env.ORCHESTRATION_TRACE;
  const work = process.env.ORCHESTRATION_WORK;
  const catalogPath = process.env.ORCHESTRATION_MODEL_CATALOG;
  if (!trace || !work || !catalogPath) throw new Error("Use the isolated orchestration launcher");
  let catalog: { agents: Record<string, { model: string; thinking: string }> };
  try {
    catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  } catch {
    throw new Error("Invalid eval model catalog");
  }
  const instructionBody = readFileSync(
    resolve(catalogPath, "../instructions/orchestration/index.md"),
    "utf8",
  )
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "")
    .trim();
  if (!instructionBody) throw new Error("Missing instruction treatment snapshot");
  const state = stateFor(trace);
  let parent = false;
  let session = "";
  let turns = 0;
  const record = (kind: string, data: Record<string, unknown> = {}) => {
    appendFileSync(trace, `${JSON.stringify({ kind, session, parent, ...data })}\n`, {
      mode: 0o600,
    });
  };
  const safeTools = new Set([
    "read",
    "grep",
    "find",
    "ls",
    "subagent",
    "get_subagent_result",
    "steer_subagent",
    "assess_subagent_checkpoint",
    "eval_gate",
    "notify_parent",
    "ask_parent",
  ]);
  const root = realpathSync(work);
  const home = process.env.HOME ?? "";
  const skillFile = realpathSync(resolve(home, ".agents/skills/swarm/SKILL.md"));
  const instructionRoot = realpathSync(resolve(home, ".pi/agent/instructions/orchestration"));
  const instructionFiles = new Set(
    readdirSync(instructionRoot)
      .filter((name) => name.endsWith(".md"))
      .map((name) => realpathSync(resolve(instructionRoot, name))),
  );
  function allowedPath(path: string): boolean {
    try {
      const expanded = path.startsWith("~/") ? resolve(home, path.slice(2)) : resolve(root, path);
      const absolute = realpathSync(expanded);
      return (
        absolute === root ||
        absolute.startsWith(root + sep) ||
        absolute === skillFile ||
        instructionFiles.has(absolute)
      );
    } catch {
      return false;
    }
  }
  pi.on("session_start", (_event, ctx) => {
    session = ctx.sessionManager.getSessionId();
    parent = pi.getActiveTools().includes("subagent");
    pi.setActiveTools(pi.getActiveTools().filter((name) => safeTools.has(name)));
    record("session", { tools: pi.getActiveTools() });
  });
  pi.on("before_agent_start", (event, ctx) => {
    const role = parent
      ? "parent"
      : /You are the (\w+) specialist\./u.exec(event.systemPrompt)?.[1];
    record("execution", {
      role,
      model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
      thinking: pi.getThinkingLevel(),
    });
    record("instructions", { loaded: event.systemPrompt.includes(instructionBody) });
    return {
      systemPrompt: `${event.systemPrompt}\n\nFixture environment: workers are read-only and limited to at most 8 turns per invocation. Only the configured specialists in the tool catalog are available.`,
    };
  });
  pi.on("before_provider_request", (event) => {
    // Record only model routing, never prompts, headers, credentials, or full payloads.
    if (typeof event.payload === "object" && event.payload !== null && "model" in event.payload) {
      const payload = event.payload as { model?: unknown; service_tier?: unknown };
      record("request-model", { model: payload.model, serviceTier: payload.service_tier });
    }
  });
  pi.on("turn_start", (_event, ctx) => {
    if (++turns > 24) {
      record("budget-exceeded");
      ctx.abort();
    }
  });
  pi.on("tool_call", (event) => {
    let denial: string | undefined;
    if (!safeTools.has(event.toolName)) denial = "Tool outside eval allowlist";
    if (["read", "grep", "find", "ls"].includes(event.toolName)) {
      const path =
        "path" in event.input && typeof event.input.path === "string" ? event.input.path : ".";
      if (!allowedPath(path))
        denial = "Reads and searches are limited to fixture files, copied swarm skill, and copied orchestration references";
      if (
        event.toolName === "find" &&
        typeof event.input.pattern === "string" &&
        /(^\/|\.\.)/u.test(event.input.pattern)
      )
        denial = "Find pattern must stay within the fixture";
    }
    if (event.toolName === "subagent" && !event.input.resume) {
      if (
        typeof event.input.subagent_type !== "string" ||
        !(event.input.subagent_type in catalog.agents)
      )
        denial = "Choose a configured specialist from the fixture catalog";
      if (event.input.model !== undefined || event.input.thinking !== undefined)
        denial = "Specialists must retain their configured model and thinking settings";
      if (typeof event.input.max_turns === "number" && event.input.max_turns > 8)
        denial = "Worker budget exceeds eight turns";
    }
    if (denial) {
      record("denied", {
        id: event.toolCallId,
        tool: event.toolName,
        input: event.input,
        reason: denial,
      });
      return { block: true, reason: denial };
    }
    record("call", { id: event.toolCallId, tool: event.toolName, input: event.input });
  });
  pi.on("tool_result", (event) => {
    const text = event.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    record("result", { id: event.toolCallId, tool: event.toolName, text, error: event.isError });
    if (
      parent &&
      event.toolName === "steer_subagent" &&
      !event.isError &&
      /^Steering message (?:sent|queued)/u.test(text)
    ) {
      record("released", { child: state.child, agentId: event.input.agent_id });
      state.released.resolve();
    }
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const text = event.message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    if (event.message.stopReason === "error") record("model-error");
    if (text)
      record("assistant", {
        text,
        stopReason: event.message.stopReason,
        hasToolCalls: event.message.content.some((block) => block.type === "toolCall"),
      });
  });
  pi.registerTool({
    name: "eval_gate",
    label: "Fixture coordination",
    description:
      "Controlled fixture coordination. A worker uses wait only when assigned a steering protocol; its parent uses observe. Workers asked by their fixture file to synchronize use barrier with the file's left/right key. This tool never assesses or steers workers.",
    parameters: Type.Object({
      action: StringEnum(["wait", "observe", "barrier"] as const),
      key: Type.Optional(StringEnum(["left", "right"] as const)),
    }),
    async execute(_id, params, signal) {
      if (params.action === "barrier") {
        if (parent || !params.key || state.arrivals.has(params.key))
          throw new Error("Each worker must enter one distinct barrier key");
        state.arrivals.set(params.key, session);
        record("barrier-arrived", { key: params.key });
        if (state.arrivals.size === 2 && new Set(state.arrivals.values()).size === 2)
          state.parallel.resolve();
        await wait(state.parallel.promise, signal);
        record("barrier-passed", { key: params.key });
        return {
          content: [
            {
              type: "text",
              text: "Both independent workers are active. Finish your assigned report.",
            },
          ],
          details: {},
        };
      }
      if (params.action === "wait") {
        if (parent || state.child) throw new Error("Only one child may enter the steering gate");
        state.child = session;
        record("checkpoint-ready");
        state.ready.resolve();
        await wait(state.released.promise, signal);
        return {
          content: [{ type: "text", text: "Follow the parent's steering message now." }],
          details: {},
        };
      }
      if (!parent) throw new Error("Only the parent may observe the checkpoint");
      await wait(state.ready.promise, signal);
      const marker = `steered-${randomUUID()}`;
      record("challenge", { marker });
      return {
        content: [
          {
            type: "text",
            text: `Scope-change checkpoint: the worker proposes reading outside-scope.txt to expand its report. Only assigned.txt is required. Worker is still running. Include this confirmation marker in your steering and request it in the worker's final report: ${marker}`,
          },
        ],
        details: {},
      };
    },
  });
}
