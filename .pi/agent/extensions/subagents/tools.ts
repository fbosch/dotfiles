import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Box, type Component, Spacer } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { INACTIVE_SPECIALIST_TOOL } from "../../lib/tool-exposure";
import {
  inspectable,
  type OpenWorker,
  resultWorkerTarget,
  type WorkerRenderState,
} from "./interaction";
import { LaunchCards, type WorkerLookup } from "./launch-cards";
import type { ParentRuntime } from "./parent-runtime";
import { type AgentAppearance, renderCall, renderResult } from "./rendering";

function frame(
  component: Component,
  theme: Theme,
  isError: boolean,
  slot: "call" | "result",
  state: WorkerRenderState,
): Component {
  if (slot === "result") state.hasResult = true;
  const box = new Box(1, 0, (line) => theme.bg(isError ? "toolErrorBg" : "toolSuccessBg", line));
  if (slot === "call") box.addChild(new Spacer(1));
  box.addChild(component);
  // Call and result share one padded card; move the bottom padding when the result arrives.
  box.addChild({
    render: () => (slot === "result" || !state.hasResult ? [""] : []),
    invalidate() {},
  });
  return box;
}

const id = Type.String({ minLength: 1 });
const text = Type.String({ minLength: 1 });
const turns = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const inspection = Type.Union([
  Type.Object({ mode: Type.Literal("status"), workerId: Type.Optional(id) }),
  Type.Object({ mode: Type.Literal("report"), workerId: id, assignmentId: Type.Optional(id) }),
  Type.Object({
    mode: Type.Literal("transcript"),
    workerId: id,
    assignmentId: Type.Optional(id),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  }),
  Type.Object({
    mode: Type.Literal("wait"),
    workerId: id,
    assignmentId: id,
    timeoutMs: Type.Optional(Type.Number({ minimum: 0 })),
  }),
]);
const control = Type.Union([
  Type.Object({
    action: Type.Literal("continue"),
    workerId: id,
    prompt: text,
    maxTurns: Type.Optional(turns),
    hardMaxTurns: Type.Optional(turns),
  }),
  Type.Object({
    action: Type.Literal("reply"),
    workerId: id,
    assignmentId: id,
    questionId: id,
    text,
  }),
  Type.Object({ action: Type.Literal("steer"), workerId: id, assignmentId: id, text }),
  Type.Object({
    action: Type.Literal("extend-budget"),
    workerId: id,
    assignmentId: id,
    additionalTurns: turns,
  }),
  Type.Object({
    action: Type.Union([Type.Literal("cancel"), Type.Literal("release")]),
    workerId: id,
  }),
]);
function result(value: unknown) {
  return {
    content: [
      { type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) },
    ],
    details: undefined,
  };
}

/** Register only in the parent; child capability preflight excludes these names. */
export function registerParentTools(
  pi: Pick<ExtensionAPI, "registerTool">,
  getRuntime: (context: ExtensionContext) => ParentRuntime | Promise<ParentRuntime>,
  appearance: () => AgentAppearance = () => new Map(),
  open?: OpenWorker,
  lookup?: WorkerLookup,
): LaunchCards {
  const cards = new LaunchCards(lookup);
  pi.registerTool({
    ...INACTIVE_SPECIALIST_TOOL,
    name: "subagent",
    label: "Launch specialist",
    promptGuidelines: [
      "Discover subagent_result or subagent_control with tool_search when worker inspection or control is needed; loading subagent does not load these tools.",
    ],
    description:
      "Launch one named specialist. Background is the default; foreground returns its report or blocking question. Optional inherited context contains only parent narrative text. maxTurns is the initial allowance; hardMaxTurns may only lower a configured specialist ceiling. A report is evidence, not verification.",
    parameters: Type.Object({
      specialist: id,
      prompt: text,
      foreground: Type.Optional(Type.Boolean()),
      inheritContext: Type.Optional(Type.Boolean()),
      maxTurns: Type.Optional(turns),
      hardMaxTurns: Type.Optional(turns),
      model: Type.Optional(id),
      thinking: Type.Optional(
        Type.Union(
          (["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).map((value) =>
            Type.Literal(value),
          ),
        ),
      ),
    }),
    renderShell: "self",
    renderCall: (
      args,
      theme,
      context: {
        state: WorkerRenderState;
        toolCallId: string;
        invalidate: () => void;
        isError: boolean;
      },
    ) => {
      const current = cards.current(context.state.target);
      return cards.wrap(
        frame(
          inspectable(
            renderCall(
              "launch",
              {
                ...args,
                specialist: current?.specialist ?? args.specialist,
                prompt: current?.prompt ?? args.prompt,
              },
              theme,
              appearance(),
            ),
            () => context.state.target,
            open,
          ),
          theme,
          context.isError,
          "call",
          context.state,
        ),
        () => context.state.target,
        context,
      );
    },
    renderResult: (
      result,
      options,
      theme,
      context: {
        state: WorkerRenderState;
        toolCallId: string;
        invalidate: () => void;
        isError: boolean;
      },
    ) => {
      const target = resultWorkerTarget(result);
      if (target) context.state.target = target;
      return cards.wrap(
        frame(
          renderResult(
            cards.project(result, context),
            { ...options, compact: true, open, target },
            theme,
            appearance(),
          ),
          theme,
          context.isError,
          "result",
          context.state,
        ),
        () => target,
        context,
      );
    },
    async execute(_call, args, signal, update, context) {
      return result(
        await (await getRuntime(context)).launch(args, signal, (status) =>
          update?.(result(status)),
        ),
      );
    },
  });
  pi.registerTool({
    ...INACTIVE_SPECIALIST_TOOL,
    name: "subagent_result",
    label: "Inspect specialist",
    description:
      "Inspect parent-owned worker status, retrieve a complete report, or read a bounded transcript page. Background workers send completion notifications; normally return control instead of waiting. Use wait only for explicitly synchronous workflows: it blocks the parent turn and delays handling queued user messages. Interrupting or timing out a wait does not cancel the worker.",
    parameters: Type.Object({ request: inspection }),
    renderShell: "self",
    renderCall: (args, theme, context) => {
      const target = args.request?.workerId ? { workerId: args.request.workerId } : undefined;
      return cards.wrap(
        frame(
          inspectable(renderCall("inspect", args, theme, appearance()), () => target, open),
          theme,
          context.isError,
          "call",
          context.state,
        ),
        () => target,
        context,
        () => !context.state.hasResult || context.state.hideStatusList === true,
      );
    },
    renderResult: (result, options, theme, context) => {
      const target =
        resultWorkerTarget(result) ??
        (context.args.request?.workerId ? { workerId: context.args.request.workerId } : undefined);
      const list =
        !context.isError && context.args.request?.mode === "status" && !target
          ? cards.statusList(result)
          : undefined;
      context.state.hideStatusList = list?.hidden ?? false;
      const projected = list?.result ?? cards.project(result, context, target);
      return cards.wrap(
        frame(
          renderResult(
            projected,
            { ...options, open, target },
            theme,
            appearance(),
            projected === result && context.args.request?.mode === "report",
          ),
          theme,
          context.isError,
          "result",
          context.state,
        ),
        () => target,
        context,
        () => context.state.hideStatusList === true,
      );
    },
    async execute(_call, args, signal, _update, context) {
      return result(await (await getRuntime(context)).inspect(args.request, signal));
    },
  });
  pi.registerTool({
    ...INACTIVE_SPECIALIST_TOOL,
    name: "subagent_control",
    label: "Control specialist",
    description:
      "Continue a retained worker, answer its correlated question, steer current work, extend a waiting assignment budget, cancel work, or release an idle session. Continuations accept an initial maxTurns and optional lowering-only hardMaxTurns. Cancellation is terminal; a stopping response is not confirmed termination.",
    parameters: Type.Object({ request: control }),
    renderShell: "self",
    renderCall: (args, theme, context) => {
      const target = args.request?.workerId ? { workerId: args.request.workerId } : undefined;
      return cards.wrap(
        frame(
          inspectable(renderCall("control", args, theme, appearance()), () => target, open),
          theme,
          context.isError,
          "call",
          context.state,
        ),
        () => target,
        context,
        () => !context.state.hasResult,
      );
    },
    renderResult: (result, options, theme, context) => {
      const target =
        resultWorkerTarget(result) ??
        (context.args.request?.workerId ? { workerId: context.args.request.workerId } : undefined);
      return cards.wrap(
        frame(
          renderResult(
            cards.project(result, context, target),
            { ...options, open, target },
            theme,
            appearance(),
          ),
          theme,
          context.isError,
          "result",
          context.state,
        ),
        () => target,
        context,
      );
    },
    async execute(_call, args, _signal, _update, context) {
      return result(await (await getRuntime(context)).control(args.request));
    },
  });
  return cards;
}
