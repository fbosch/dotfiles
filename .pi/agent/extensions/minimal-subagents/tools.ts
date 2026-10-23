import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ParentRuntime } from "./parent-runtime";
import { renderCall, renderResult, type AgentAppearance } from "./rendering";
import { inspectable, resultWorkerTarget, type OpenWorker, type WorkerRenderState } from "./interaction";

const id = Type.String({ minLength: 1 });
const text = Type.String({ minLength: 1 });
const turns = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const inspection = Type.Union([
  Type.Object({ mode: Type.Literal("status"), workerId: Type.Optional(id) }),
  Type.Object({ mode: Type.Literal("report"), workerId: id, assignmentId: Type.Optional(id) }),
  Type.Object({ mode: Type.Literal("transcript"), workerId: id, assignmentId: Type.Optional(id), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) }),
  Type.Object({ mode: Type.Literal("wait"), workerId: id, assignmentId: id, timeoutMs: Type.Optional(Type.Number({ minimum: 0 })) }),
]);
const control = Type.Union([
  Type.Object({ action: Type.Literal("continue"), workerId: id, prompt: text, maxTurns: Type.Optional(turns) }),
  Type.Object({ action: Type.Literal("reply"), workerId: id, assignmentId: id, questionId: id, text }),
  Type.Object({ action: Type.Literal("steer"), workerId: id, assignmentId: id, text }),
  Type.Object({ action: Type.Literal("extend-budget"), workerId: id, assignmentId: id, additionalTurns: turns }),
  Type.Object({ action: Type.Union([Type.Literal("cancel"), Type.Literal("release")]), workerId: id }),
]);
function result(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }], details: undefined };
}

/** Register only in the parent; child capability preflight excludes these names. */
export function registerParentTools(pi: Pick<ExtensionAPI, "registerTool">, getRuntime: (context: ExtensionContext) => ParentRuntime | Promise<ParentRuntime>, appearance: () => AgentAppearance = () => new Map(), open?: OpenWorker): void {
  pi.registerTool({
    name: "subagent", label: "Launch specialist",
    description: "Launch one named specialist. Background is the default; foreground returns its report or blocking question. Optional inherited context contains only parent narrative text. A report is evidence, not verification.",
    parameters: Type.Object({
      specialist: id, prompt: text, foreground: Type.Optional(Type.Boolean()), inheritContext: Type.Optional(Type.Boolean()),
      maxTurns: Type.Optional(turns), model: Type.Optional(id),
      thinking: Type.Optional(Type.Union((["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).map((value) => Type.Literal(value)))),
    }),
    renderCall: (args, theme, context: { state: WorkerRenderState }) => inspectable(renderCall("launch", args, theme, appearance()), () => context.state.target, open),
    renderResult: (result, options, theme, context: { state: WorkerRenderState }) => {
      const target = resultWorkerTarget(result);
      if (target) context.state.target = target;
      return renderResult(result, { ...options, compact: true, open, target }, theme, appearance());
    },
    async execute(_call, args, signal, update, context) {
      return result(await (await getRuntime(context)).launch(args, signal, (status) => update?.(result(status))));
    },
  });
  pi.registerTool({
    name: "subagent_result", label: "Inspect specialist",
    description: "Inspect parent-owned worker status, retrieve a complete report, read a bounded transcript page, or wait for an assignment. Interrupting or timing out a background wait does not cancel the worker.",
    parameters: Type.Object({ request: inspection }),
    renderCall: (args, theme) => inspectable(renderCall("inspect", args, theme, appearance()), () => "workerId" in args.request ? { workerId: args.request.workerId } : undefined, open),
    renderResult: (result, options, theme, context) => renderResult(result, { ...options, open, target: "workerId" in context.args.request ? { workerId: context.args.request.workerId } : undefined }, theme, appearance(), context.args.request.mode === "report"),
    async execute(_call, args, signal, _update, context) {
      return result(await (await getRuntime(context)).inspect(args.request, signal));
    },
  });
  pi.registerTool({
    name: "subagent_control", label: "Control specialist",
    description: "Continue a retained worker, answer its correlated question, steer current work, extend a waiting assignment budget, cancel work, or release an idle session. Cancellation is terminal; a stopping response is not confirmed termination.",
    parameters: Type.Object({ request: control }),
    renderCall: (args, theme) => inspectable(renderCall("control", args, theme, appearance()), () => ({ workerId: args.request.workerId }), open),
    renderResult: (result, options, theme) => renderResult(result, options, theme, appearance()),
    async execute(_call, args, _signal, _update, context) {
      return result(await (await getRuntime(context)).control(args.request));
    },
  });
}
