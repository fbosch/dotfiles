import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { requestVercelGateway } from "../../lib/vercel-gateway";
import { isRecord } from "../shared/is-record";

const ENGINE = "lightpanda";
const COMMAND_TIMEOUT_MS = 30_000;
const DECISION_TIMEOUT_MS = 2_000;
const MAX_PAGE_STATE_CHARS = 24_000;
const MAX_ACTIONS = 20;
const MAX_ACTION_DESCRIPTION_CHARS = 300;
const NO_ACTION = "no_action";

const OpenParameters = Type.Object(
  { url: Type.String({ minLength: 1, maxLength: 4_096 }) },
  { additionalProperties: false },
);

const SnapshotParameters = Type.Object(
  {
    interactiveOnly: Type.Optional(Type.Boolean()),
    includeUrls: Type.Optional(Type.Boolean()),
    selector: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
  },
  { additionalProperties: false },
);

const ActParameters = Type.Object(
  {
    action: StringEnum(["click", "fill", "type", "press", "check", "uncheck", "hover"] as const),
    target: Type.String({ minLength: 1, maxLength: 1_000 }),
    value: Type.Optional(Type.String({ maxLength: 20_000 })),
  },
  { additionalProperties: false },
);

const DecisionAction = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ minLength: 1, maxLength: MAX_ACTION_DESCRIPTION_CHARS }),
  },
  { additionalProperties: false },
);

const DecideParameters = Type.Object(
  {
    objective: Type.String({ minLength: 1, maxLength: 2_000 }),
    pageState: Type.String({ minLength: 1, maxLength: MAX_PAGE_STATE_CHARS }),
    actions: Type.Array(DecisionAction, { minItems: 1, maxItems: MAX_ACTIONS }),
  },
  { additionalProperties: false },
);

type OpenInput = Static<typeof OpenParameters>;
type SnapshotInput = Static<typeof SnapshotParameters>;
type ActInput = Static<typeof ActParameters>;
type DecideInput = Static<typeof DecideParameters>;

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly killed: boolean;
}

export interface BrowserDecision {
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
}

function sessionName(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 48);
  return `pi-${safe || "browser"}`;
}

export function browserArgs(sessionId: string, command: readonly string[]): string[] {
  return ["--engine", ENGINE, "--session", sessionName(sessionId), ...command];
}

function commandOutput(result: CommandResult): string {
  const output = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join("\n");
  return output || `(agent-browser exited with code ${result.code ?? "unknown"})`;
}

function boundedOutput(output: string): string {
  const truncated = truncateHead(output, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  return truncated.truncated
    ? `${truncated.content}\n\n[agent-browser output truncated]`
    : truncated.content;
}

async function runBrowser(
  pi: ExtensionAPI,
  sessionId: string,
  command: readonly string[],
  signal?: AbortSignal,
): Promise<CommandResult> {
  const result = await pi.exec("agent-browser", browserArgs(sessionId, command), {
    ...(signal === undefined ? {} : { signal }),
    timeout: COMMAND_TIMEOUT_MS,
  });
  if (result.code !== 0) throw new Error(commandOutput(result));
  return result;
}

export function createDecisionRequest(input: DecideInput): Record<string, unknown> {
  const criteria = Object.fromEntries(
    input.actions.map((action) => [action.id, action.description]),
  );
  criteria[NO_ACTION] = "None of the supplied actions safely advances the objective.";

  return {
    state: {
      objective: input.objective,
      page_state: input.pageState,
      candidate_actions: input.actions,
    },
    questions: {
      next_action: {
        type: "choice",
        instructions:
          "Which supplied action best advances the objective based only on the observed page state? Choose no_action when evidence is insufficient or no action is appropriate.",
        criteria,
      },
    },
  };
}

export function parseDecision(
  value: unknown,
  actionIds: readonly string[],
): BrowserDecision | undefined {
  if (!isRecord(value) || !isRecord(value.answers)) return undefined;
  const answer = value.answers.next_action;
  if (!isRecord(answer) || answer.type !== "choice" || typeof answer.choice !== "string") {
    return undefined;
  }
  if (!isRecord(answer.probabilities)) return undefined;

  const expected = [...actionIds, NO_ACTION];
  if (!expected.includes(answer.choice)) return undefined;
  if (Object.keys(answer.probabilities).length !== expected.length) return undefined;

  const probabilities: Record<string, number> = {};
  let total = 0;
  for (const id of expected) {
    const probability = answer.probabilities[id];
    if (
      typeof probability !== "number" ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      return undefined;
    }
    probabilities[id] = probability;
    total += probability;
  }
  if (Math.abs(total - 1) > 0.02) return undefined;

  return { choice: answer.choice, probabilities };
}

export default function agentBrowserExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "browser_open",
    label: "Open browser page",
    description: "Open a URL in the session-owned agent-browser Lightpanda instance.",
    parameters: OpenParameters,
    async execute(_toolCallId, params: OpenInput, signal, _onUpdate, ctx) {
      const result = await runBrowser(
        pi,
        ctx.sessionManager.getSessionId(),
        ["open", params.url],
        signal,
      );
      return {
        content: [{ type: "text", text: boundedOutput(commandOutput(result)) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "browser_snapshot",
    label: "Snapshot browser page",
    description:
      "Read the current page accessibility snapshot and stable element refs from agent-browser. Output is bounded to 50KB or 2000 lines.",
    parameters: SnapshotParameters,
    async execute(_toolCallId, params: SnapshotInput, signal, _onUpdate, ctx) {
      const command = ["snapshot"];
      if (params.interactiveOnly !== false) command.push("-i");
      if (params.includeUrls === true) command.push("-u");
      if (params.selector !== undefined) command.push("-s", params.selector);
      const result = await runBrowser(pi, ctx.sessionManager.getSessionId(), command, signal);
      return {
        content: [{ type: "text", text: boundedOutput(commandOutput(result)) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "browser_act",
    label: "Act in browser",
    description:
      "Perform one bounded interaction in the current agent-browser page. Use refs from a fresh browser_snapshot.",
    parameters: ActParameters,
    async execute(_toolCallId, params: ActInput, signal, _onUpdate, ctx) {
      const needsValue = params.action === "fill" || params.action === "type";
      if (needsValue && params.value === undefined) {
        throw new Error(`${params.action} requires value`);
      }
      if (!needsValue && params.value !== undefined) {
        throw new Error(`${params.action} does not accept value`);
      }
      const command = [params.action, params.target];
      if (params.value !== undefined) command.push(params.value);
      const result = await runBrowser(pi, ctx.sessionManager.getSessionId(), command, signal);
      return {
        content: [{ type: "text", text: boundedOutput(commandOutput(result)) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "browser_decide",
    label: "Choose browser action",
    description:
      "Ask Jev to choose among explicit candidate browser actions using a bounded page snapshot. This is advisory and never executes the action.",
    parameters: DecideParameters,
    async execute(_toolCallId, params: DecideInput, signal, _onUpdate, ctx) {
      const ids = params.actions.map((action) => action.id);
      if (new Set(ids).size !== ids.length || ids.includes(NO_ACTION)) {
        throw new Error(`Action ids must be unique and must not use reserved id ${NO_ACTION}`);
      }

      const gateway = await requestVercelGateway(ctx.modelRegistry, createDecisionRequest(params), {
        ...(signal === undefined ? {} : { signal }),
        timeoutMs: DECISION_TIMEOUT_MS,
      });
      if (!gateway.ok) {
        throw new Error(`Jev browser decision failed: ${gateway.reason}`);
      }

      const decision = parseDecision(gateway.value, ids);
      if (decision === undefined) throw new Error("Jev returned an invalid browser decision");
      const selectedProbability = decision.probabilities[decision.choice];
      if (selectedProbability === undefined) throw new Error("Jev omitted selected probability");
      const text =
        decision.choice === NO_ACTION
          ? `No action selected (${selectedProbability.toFixed(3)})`
          : `Selected ${decision.choice} (${selectedProbability.toFixed(3)})`;
      return { content: [{ type: "text", text }], details: decision };
    },
  });
}
