import { appendFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface Gate {
  ready: Promise<void>;
  markReady: () => void;
  released: Promise<void>;
  release: () => void;
  child?: string;
}

// SDK workers share a process but load separate extension instances. This gate
// holds a real child tool open until the native steer tool has accepted a message.
const shared = globalThis as typeof globalThis & { __orchestrationEvalGates?: Map<string, Gate> };
shared.__orchestrationEvalGates ??= new Map<string, Gate>();
const gates = shared.__orchestrationEvalGates;
function gateFor(trace: string): Gate {
  let gate = gates.get(trace);
  if (!gate) {
    const ready = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    gate = {
      ready: ready.promise,
      markReady: ready.resolve,
      released: released.promise,
      release: released.resolve,
    };
    gates.set(trace, gate);
  }
  return gate;
}

async function boundedWait(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  const deadline = AbortSignal.timeout(90_000);
  const combined = signal ? AbortSignal.any([deadline, signal]) : deadline;
  combined.throwIfAborted();
  await new Promise<void>((resolveWait, reject) => {
    const abort = () => reject(new Error("Fixture gate cancelled or timed out"));
    combined.addEventListener("abort", abort, { once: true });
    promise.then(resolveWait, reject).finally(() => combined.removeEventListener("abort", abort));
  });
}

export default function orchestrationFixture(pi: ExtensionAPI): void {
  const trace = process.env.ORCHESTRATION_TRACE;
  const work = process.env.ORCHESTRATION_WORK;
  if (!trace || !work) throw new Error("Orchestration fixture requires its isolated launcher");
  const gate = gateFor(trace);
  let parent = false;
  let session = "";
  let turns = 0;
  pi.on("turn_start", (_event, ctx) => {
    if (++turns > 16) ctx.abort();
  });
  const record = (kind: string, data: Record<string, unknown> = {}) => {
    appendFileSync(trace, `${JSON.stringify({ kind, session, parent, ...data })}\n`, {
      mode: 0o600,
    });
  };
  const allowed = new Set([
    "read",
    "subagent",
    "get_subagent_result",
    "steer_subagent",
    "assess_subagent_checkpoint",
    "eval_gate",
    "notify_parent",
    "ask_parent",
  ]);
  pi.on("session_start", (_event, ctx) => {
    session = ctx.sessionManager.getSessionId();
    parent = pi.getActiveTools().includes("subagent");
    pi.setActiveTools(pi.getActiveTools().filter((name) => allowed.has(name)));
    record("session", { tools: pi.getActiveTools() });
  });
  pi.on("before_agent_start", (event) => {
    record("instructions", { loaded: event.systemPrompt.includes("# Subagent orchestration") });
  });
  pi.on("tool_call", (event) => {
    // The candidate may read only the two synthetic files. No shell, writes,
    // auth/spec/trace reads, or arbitrary project exploration in this fixture.
    if (!allowed.has(event.toolName)) return { block: true, reason: "Tool outside eval allowlist" };
    if (event.toolName === "read") {
      const path = typeof event.input.path === "string" ? event.input.path : "";
      let permitted = false;
      try {
        const actual = realpathSync(resolve(work, path));
        permitted = ["assigned.txt", "outside-scope.txt"].some(
          (name) => actual === realpathSync(resolve(work, name)),
        );
      } catch {
        /* Invalid paths stay denied. */
      }
      if (!permitted) {
        record("denied", { tool: event.toolName });
        return { block: true, reason: "Read limited to synthetic fixture files" };
      }
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
      record("released", { child: gate.child, agentId: event.input.agent_id });
      gate.release();
    }
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const text = event.message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    if (text)
      record("assistant", {
        text,
        stopReason: event.message.stopReason,
        hasToolCalls: event.message.content.some((block) => block.type === "toolCall"),
      });
  });
  pi.registerTool({
    name: "eval_gate",
    label: "Eval checkpoint gate",
    description:
      "Controlled test protocol only. Worker uses wait to report a scope-change checkpoint and stay running. Parent uses observe to receive that checkpoint. No steering is performed by this tool.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("wait"), Type.Literal("observe")]),
    }),
    async execute(_id, params, signal) {
      if (params.action === "wait") {
        if (parent || gate.child) throw new Error("Only one child may enter the gate");
        gate.child = session;
        record("checkpoint-ready");
        gate.markReady();
        await boundedWait(gate.released, signal);
        return {
          content: [
            {
              type: "text",
              text: "Checkpoint released. Follow the parent's steering message now.",
            },
          ],
          details: {},
        };
      }
      if (!parent) throw new Error("Only the parent may observe the checkpoint");
      await boundedWait(gate.ready, signal);
      const marker = `steered-${crypto.randomUUID()}`;
      record("challenge", { marker });
      return {
        content: [
          {
            type: "text",
            text: `Scope-change checkpoint: the worker proposes reading outside-scope.txt to expand the report. Its assignment only requires assigned.txt; no expansion is needed. Worker is still running at the gate. In your steering message ask it to include this confirmation marker in its final report: ${marker}`,
          },
        ],
        details: {},
      };
    },
  });
}
