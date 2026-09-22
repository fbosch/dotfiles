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
const DEFAULT_STEP_CONFIDENCE = 0.75;
const DEFAULT_RUN_STEPS = 5;
const MAX_RUN_STEPS = 10;
const INTERACTIVE_SNAPSHOT_LINE =
  /^- (button|link|textbox|searchbox|checkbox|radio|combobox) "([^"]*)" \[([^\]]*\bref=(e\d+)[^\]]*)\](?::.*)?$/u;
const DEFAULT_STEP_SAFETY_CONFIDENCE = 0.9;
const CLICKABLE_SNAPSHOT_LINE = /^- (?:button|link) "([^"]+)" \[ref=(e\d+)(?:,[^\]]*)?\]$/u;

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
    action: StringEnum([
      "click",
      "fill",
      "type",
      "press",
      "check",
      "uncheck",
      "hover",
      "select",
    ] as const),
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

const StepParameters = Type.Object(
  {
    objective: Type.String({ minLength: 1, maxLength: 2_000 }),
    confidenceThreshold: Type.Optional(Type.Number({ minimum: 0.5, maximum: 1 })),
  },
  { additionalProperties: false },
);

const RunInputValue = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    value: Type.String({ maxLength: 20_000 }),
    sensitive: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const RunParameters = Type.Object(
  {
    objective: Type.String({ minLength: 1, maxLength: 2_000 }),
    inputs: Type.Optional(Type.Array(RunInputValue, { maxItems: 10 })),
    maxSteps: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_RUN_STEPS })),
    confidenceThreshold: Type.Optional(Type.Number({ minimum: 0.5, maximum: 1 })),
    authorizationThreshold: Type.Optional(Type.Number({ minimum: 0.5, maximum: 1 })),
  },
  { additionalProperties: false },
);

type OpenInput = Static<typeof OpenParameters>;
type SnapshotInput = Static<typeof SnapshotParameters>;
type ActInput = Static<typeof ActParameters>;
type DecideInput = Static<typeof DecideParameters>;
type StepInput = Static<typeof StepParameters>;
type RunInput = Static<typeof RunParameters>;
type RunValue = Static<typeof RunInputValue>;

export interface ClickCandidate {
  readonly id: string;
  readonly ref: string;
  readonly label: string;
  readonly description: string;
}

export interface RunCandidate {
  readonly id: string;
  readonly description: string;
  readonly command: readonly string[];
  readonly authorization: "choice" | "independent";
  readonly trace: {
    readonly action: "click" | "fill" | "check" | "uncheck" | "select";
    readonly ref: string;
    readonly label: string;
    readonly input?: string;
  };
}

export interface RunTraceEntry {
  readonly step: number;
  readonly snapshot: string;
  readonly action: RunCandidate["trace"];
  readonly probability: number;
  readonly selectionMode: "deterministic" | "jev";
  readonly authorizationMode: "choice" | "independent";
  readonly authorizationProbability?: number;
}

export interface StepDecision {
  readonly executed: boolean;
  readonly reason: "executed" | "no_action" | "low_confidence" | "unsafe_or_uncertain";
  readonly candidate?: ClickCandidate;
  readonly probability: number;
  readonly safetyProbability?: number;
}

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

async function settleAfterAction(
  pi: ExtensionAPI,
  sessionId: string,
  action: RunCandidate["trace"]["action"],
  signal?: AbortSignal,
): Promise<void> {
  if (action !== "click") return;
  // A separate CLI click can resolve before Lightpanda announces the navigation it initiated.
  await runBrowser(pi, sessionId, ["wait", "150"], signal);
  await runBrowser(pi, sessionId, ["wait", "--load", "domcontentloaded"], signal);
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

export function parseClickCandidates(snapshot: string): ClickCandidate[] {
  const candidates: ClickCandidate[] = [];
  for (const line of snapshot.split(/\r?\n/u)) {
    const match = CLICKABLE_SNAPSHOT_LINE.exec(line.trim());
    const label = match?.[1];
    const ref = match?.[2];
    if (label === undefined || ref === undefined) continue;
    candidates.push({
      id: ref,
      ref: `@${ref}`,
      label,
      description: `Click ${label} at @${ref}.`,
    });
    if (candidates.length >= MAX_ACTIONS) break;
  }
  return candidates;
}

function summarizedInput(input: RunValue): string {
  if (input.sensitive === true)
    return `the provided sensitive value named ${JSON.stringify(input.name)}`;
  const value = input.value.length > 100 ? `${input.value.slice(0, 100)}…` : input.value;
  return `${JSON.stringify(input.name)} (${JSON.stringify(value)})`;
}
function normalizedControlName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function inputMatchesControl(input: RunValue, label: string): boolean {
  const inputName = normalizedControlName(input.name);
  const controlName = normalizedControlName(label);
  return (
    inputName.length >= 3 &&
    controlName.length >= 3 &&
    (inputName.includes(controlName) || controlName.includes(inputName))
  );
}

export function parseRunCandidates(
  snapshot: string,
  inputs: readonly RunValue[] = [],
): RunCandidate[] {
  const candidates: RunCandidate[] = [];
  const indexedInputs = inputs.map((input, inputIndex) => ({ input, inputIndex }));
  const hasNamedMatches = snapshot.split(/\r?\n/u).some((line) => {
    const match = INTERACTIVE_SNAPSHOT_LINE.exec(line.trim());
    const role = match?.[1];
    const label = match?.[2];
    return (
      (role === "textbox" || role === "searchbox" || role === "combobox") &&
      label !== undefined &&
      inputs.some((input) => inputMatchesControl(input, label))
    );
  });
  const add = (candidate: RunCandidate): void => {
    if (candidates.length < MAX_ACTIONS) candidates.push(candidate);
  };

  for (const line of snapshot.split(/\r?\n/u)) {
    const match = INTERACTIVE_SNAPSHOT_LINE.exec(line.trim());
    const role = match?.[1];
    const label = match?.[2];
    const rawRef = match?.[4];
    const attributes = match?.[3];
    if (
      role === undefined ||
      label === undefined ||
      rawRef === undefined ||
      attributes === undefined
    ) {
      continue;
    }
    const ref = `@${rawRef}`;
    const displayLabel = label || role;

    if (role === "button" || role === "link") {
      add({
        id: `click:${rawRef}`,
        description: `Click ${JSON.stringify(displayLabel)} at ${ref}.`,
        command: ["click", ref],
        authorization: "independent",
        trace: { action: "click", ref, label: displayLabel },
      });
    } else if (role === "checkbox" || role === "radio") {
      const checked = /(?:^|,)\s*checked(?:=true)?(?:,|$)/u.test(attributes);
      if (role === "radio" && checked) continue;
      const action = role === "radio" ? "click" : checked ? "uncheck" : "check";
      add({
        id: `${action}:${rawRef}`,
        description: `${action === "click" ? "Click" : action === "check" ? "Check" : "Uncheck"} ${JSON.stringify(displayLabel)} at ${ref}.`,
        command: [action, ref],
        authorization: "choice",
        trace: { action, ref, label: displayLabel },
      });
    } else {
      const candidateInputs = hasNamedMatches
        ? indexedInputs.filter(({ input }) => inputMatchesControl(input, displayLabel))
        : indexedInputs;
      for (const { input, inputIndex } of candidateInputs) {
        const action = role === "combobox" ? "select" : "fill";
        add({
          id: `${action}:${rawRef}:${inputIndex}`,
          description: `${action === "select" ? "Select" : "Fill"} ${summarizedInput(input)} in ${JSON.stringify(displayLabel)} at ${ref}.`,
          command: [action, ref, input.value],
          authorization: "choice",
          trace: { action, ref, label: displayLabel, input: input.name },
        });
      }
    }
    if (candidates.length >= MAX_ACTIONS) break;
  }
  return candidates;
}

export function findDeterministicInputCandidate(
  candidates: readonly RunCandidate[],
): RunCandidate | undefined {
  const inputs = candidates.filter(
    ({ trace }) => trace.action === "fill" || trace.action === "select",
  );
  return inputs.find((candidate) => {
    const input = candidate.trace.input;
    if (input === undefined) return false;
    return (
      inputs.filter(({ trace }) => trace.input === input).length === 1 &&
      inputs.filter(({ trace }) => trace.ref === candidate.trace.ref).length === 1
    );
  });
}

export function redactSensitiveInputs(snapshot: string, inputs: readonly RunValue[] = []): string {
  return inputs.reduce(
    (redacted, input) =>
      input.sensitive === true && input.value.length > 0
        ? redacted.replaceAll(input.value, `[redacted:${input.name}]`)
        : redacted,
    snapshot,
  );
}

export function createRunAuthorizationRequest(
  objective: string,
  pageState: string,
  candidate: RunCandidate,
): Record<string, unknown> {
  return {
    state: { objective, page_state: pageState, selected_action: candidate.description },
    questions: {
      authorized: {
        type: "noul",
        instructions:
          "Is this exact action directly required to fulfill the user's stated objective and supported by the observed page state?",
        criteria: {
          true: "The objective clearly requests or necessarily entails this action, including any resulting external effect.",
          false:
            "The action exceeds the objective, uses the wrong value or control, repeats completed work, lacks page evidence, or its authorization is uncertain.",
        },
      },
    },
  };
}

export function parseRunAuthorization(value: unknown): number | undefined {
  if (!isRecord(value) || !isRecord(value.answers)) return undefined;
  const answer = value.answers.authorized;
  if (!isRecord(answer) || answer.type !== "noul") return undefined;
  return typeof answer.noul === "number" &&
    Number.isFinite(answer.noul) &&
    answer.noul >= 0 &&
    answer.noul <= 1
    ? answer.noul
    : undefined;
}

export function createStepSafetyRequest(
  objective: string,
  pageState: string,
  candidate: ClickCandidate,
): Record<string, unknown> {
  return {
    state: { objective, page_state: pageState, selected_action: candidate },
    questions: {
      navigation_only: {
        type: "noul",
        instructions:
          "Is the selected click strictly a reversible navigation action that only changes the viewed page or opens navigation?",
        criteria: {
          true: "The click only navigates or reveals navigation and does not commit an external effect.",
          false:
            "The click may submit data, mutate state, communicate, purchase, delete, change permissions or accounts, or its effect is uncertain.",
        },
      },
    },
  };
}

export function parseStepSafety(value: unknown): number | undefined {
  if (!isRecord(value) || !isRecord(value.answers)) return undefined;
  const answer = value.answers.navigation_only;
  if (!isRecord(answer) || answer.type !== "noul") return undefined;
  return typeof answer.noul === "number" &&
    Number.isFinite(answer.noul) &&
    answer.noul >= 0 &&
    answer.noul <= 1
    ? answer.noul
    : undefined;
}

export function evaluateStepDecision(
  decision: BrowserDecision,
  candidates: readonly ClickCandidate[],
  confidenceThreshold: number,
): StepDecision {
  const probability = decision.probabilities[decision.choice];
  if (probability === undefined) throw new Error("Jev omitted selected probability");
  if (decision.choice === NO_ACTION) return { executed: false, reason: "no_action", probability };

  const candidate = candidates.find(({ id }) => id === decision.choice);
  if (candidate === undefined) throw new Error("Jev selected an unknown browser candidate");
  if (probability < confidenceThreshold) {
    return { executed: false, reason: "low_confidence", candidate, probability };
  }
  return { executed: true, reason: "executed", candidate, probability };
}

export function applyStepSafety(
  decision: StepDecision,
  safetyProbability: number,
  safetyThreshold = DEFAULT_STEP_SAFETY_CONFIDENCE,
): StepDecision {
  if (!decision.executed) return decision;
  return safetyProbability >= safetyThreshold
    ? { ...decision, safetyProbability }
    : { ...decision, executed: false, reason: "unsafe_or_uncertain", safetyProbability };
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
      const needsValue =
        params.action === "fill" || params.action === "type" || params.action === "select";
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
    name: "browser_step",
    label: "Take browser step",
    description:
      "Take one confidence-gated browser step: snapshot the page, use Jev to choose a clickable candidate and verify it is navigation-only, click it, then return the updated snapshot. Does not execute uncertain or consequential actions.",
    parameters: StepParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params: StepInput, signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const beforeResult = await runBrowser(pi, sessionId, ["snapshot", "-i", "-u"], signal);
      const before = boundedOutput(commandOutput(beforeResult));
      const candidates = parseClickCandidates(before);
      if (candidates.length === 0) {
        return {
          content: [{ type: "text", text: `No clickable candidates found.\n\n${before}` }],
          details: { executed: false, reason: "no_action", probability: 1, before },
        };
      }

      const choiceGateway = await requestVercelGateway(
        ctx.modelRegistry,
        createDecisionRequest({
          objective: params.objective,
          pageState: before,
          actions: candidates.map(({ id, description }) => ({ id, description })),
        }),
        {
          ...(signal === undefined ? {} : { signal }),
          timeoutMs: DECISION_TIMEOUT_MS,
        },
      );
      if (!choiceGateway.ok) throw new Error(`Jev browser step failed: ${choiceGateway.reason}`);
      const choice = parseDecision(
        choiceGateway.value,
        candidates.map(({ id }) => id),
      );
      if (choice === undefined) throw new Error("Jev returned an invalid browser step decision");

      let step = evaluateStepDecision(
        choice,
        candidates,
        params.confidenceThreshold ?? DEFAULT_STEP_CONFIDENCE,
      );
      if (step.executed && step.candidate !== undefined) {
        const safetyGateway = await requestVercelGateway(
          ctx.modelRegistry,
          createStepSafetyRequest(params.objective, before, step.candidate),
          {
            ...(signal === undefined ? {} : { signal }),
            timeoutMs: DECISION_TIMEOUT_MS,
          },
        );
        if (!safetyGateway.ok)
          throw new Error(`Jev browser safety check failed: ${safetyGateway.reason}`);
        const safetyProbability = parseStepSafety(safetyGateway.value);
        if (safetyProbability === undefined) {
          throw new Error("Jev returned an invalid browser safety decision");
        }
        step = applyStepSafety(step, safetyProbability);
      }

      if (!step.executed || step.candidate === undefined) {
        return {
          content: [
            {
              type: "text",
              text: `No click executed (${step.reason}, probability ${step.probability.toFixed(3)}).\n\n${before}`,
            },
          ],
          details: { ...step, before },
        };
      }

      await runBrowser(pi, sessionId, ["click", step.candidate.ref], signal);
      await settleAfterAction(pi, sessionId, "click", signal);
      const afterResult = await runBrowser(pi, sessionId, ["snapshot", "-i", "-u"], signal);
      const after = boundedOutput(commandOutput(afterResult));
      return {
        content: [
          {
            type: "text",
            text: `Clicked ${step.candidate.ref} (${step.candidate.label}, probability ${step.probability.toFixed(3)}).\n\n${after}`,
          },
        ],
        details: { ...step, before, after },
      };
    },
  });

  pi.registerTool({
    name: "browser_run",
    label: "Run browser workflow",
    description:
      "Run a bounded multi-step browser workflow. Explicit inputs with a unique control match run directly; Jev selects ambiguous or control actions and independently authorizes button and link clicks.",
    parameters: RunParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params: RunInput, signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const trace: RunTraceEntry[] = [];
      const seen = new Set<string>();
      const completed = new Set<string>();
      const completedDescriptions = new Map<string, string[]>();
      const maxSteps = params.maxSteps ?? DEFAULT_RUN_STEPS;
      const confidenceThreshold = params.confidenceThreshold ?? DEFAULT_STEP_CONFIDENCE;
      const authorizationThreshold =
        params.authorizationThreshold ?? DEFAULT_STEP_SAFETY_CONFIDENCE;
      let pageUrl: string | undefined;
      let stopReason = "max_steps";

      for (let stepNumber = 1; stepNumber <= maxSteps; stepNumber += 1) {
        const snapshotResult = await runBrowser(pi, sessionId, ["snapshot", "-i", "-u"], signal);
        const redactedSnapshot = redactSensitiveInputs(
          boundedOutput(commandOutput(snapshotResult)),
          params.inputs,
        );
        const snapshot = redactedSnapshot;
        pageUrl ??= commandOutput(await runBrowser(pi, sessionId, ["get", "url"], signal)).trim();
        const completedOnPage = completedDescriptions.get(pageUrl) ?? [];
        const decisionPageState =
          completedOnPage.length > 0
            ? `${snapshot}\n\nActions already completed on this page:\n${completedOnPage.map((description) => `- ${description}`).join("\n")}`
            : snapshot;
        const candidates = parseRunCandidates(snapshot, params.inputs).filter(
          ({ id }) => !completed.has(`${pageUrl}\u0000${id}`),
        );
        if (candidates.length === 0) {
          stopReason = "no_candidates";
          break;
        }

        const deterministicCandidate = findDeterministicInputCandidate(candidates);
        let candidate: RunCandidate;
        let probability: number;
        let selectionMode: RunTraceEntry["selectionMode"];

        if (deterministicCandidate !== undefined) {
          candidate = deterministicCandidate;
          probability = 1;
          selectionMode = "deterministic";
        } else {
          const choiceGateway = await requestVercelGateway(
            ctx.modelRegistry,
            createDecisionRequest({
              objective: params.objective,
              pageState: decisionPageState,
              actions: candidates.map(({ id, description }) => ({ id, description })),
            }),
            { ...(signal === undefined ? {} : { signal }), timeoutMs: DECISION_TIMEOUT_MS },
          );
          if (!choiceGateway.ok) {
            throw new Error(`Jev browser run failed: ${choiceGateway.reason}`);
          }
          const choice = parseDecision(
            choiceGateway.value,
            candidates.map(({ id }) => id),
          );
          if (choice === undefined) throw new Error("Jev returned an invalid browser run decision");
          const selectedProbability = choice.probabilities[choice.choice];
          if (selectedProbability === undefined)
            throw new Error("Jev omitted selected probability");
          if (choice.choice === NO_ACTION) {
            stopReason = "no_action";
            break;
          }
          if (selectedProbability < confidenceThreshold) {
            stopReason = "low_confidence";
            break;
          }

          const selectedCandidate = candidates.find(({ id }) => id === choice.choice);
          if (selectedCandidate === undefined) {
            throw new Error("Jev selected an unknown browser run candidate");
          }
          candidate = selectedCandidate;
          probability = selectedProbability;
          selectionMode = "jev";
        }

        const cycleKey = `${snapshot}\u0000${candidate.id}`;
        if (seen.has(cycleKey)) {
          stopReason = "cycle";
          break;
        }
        seen.add(cycleKey);

        let authorizationProbability: number | undefined;
        if (candidate.authorization === "independent") {
          const authorizationGateway = await requestVercelGateway(
            ctx.modelRegistry,
            createRunAuthorizationRequest(params.objective, decisionPageState, candidate),
            { ...(signal === undefined ? {} : { signal }), timeoutMs: DECISION_TIMEOUT_MS },
          );
          if (!authorizationGateway.ok) {
            throw new Error(`Jev browser authorization failed: ${authorizationGateway.reason}`);
          }
          authorizationProbability = parseRunAuthorization(authorizationGateway.value);
          if (authorizationProbability === undefined) {
            throw new Error("Jev returned an invalid browser authorization decision");
          }
          if (authorizationProbability < authorizationThreshold) {
            stopReason = "unauthorized_or_uncertain";
            break;
          }
        }

        await runBrowser(pi, sessionId, candidate.command, signal);
        completed.add(`${pageUrl}\u0000${candidate.id}`);
        completedDescriptions.set(pageUrl, [...completedOnPage, candidate.description]);
        await settleAfterAction(pi, sessionId, candidate.trace.action, signal);
        if (candidate.trace.action === "click") pageUrl = undefined;
        trace.push({
          step: stepNumber,
          snapshot,
          action: candidate.trace,
          probability,
          selectionMode,
          authorizationMode: candidate.authorization,
          ...(authorizationProbability === undefined ? {} : { authorizationProbability }),
        });
      }

      let finalSnapshot = redactSensitiveInputs(
        boundedOutput(
          commandOutput(await runBrowser(pi, sessionId, ["snapshot", "-i", "-u"], signal)),
        ),
        params.inputs,
      );
      const lastTrace = trace.at(-1);
      if (lastTrace?.action.action === "click" && finalSnapshot === lastTrace.snapshot) {
        await runBrowser(pi, sessionId, ["wait", "1000"], signal);
        finalSnapshot = redactSensitiveInputs(
          boundedOutput(
            commandOutput(await runBrowser(pi, sessionId, ["snapshot", "-i", "-u"], signal)),
          ),
          params.inputs,
        );
      }
      const summary = trace
        .map(
          ({
            step,
            action,
            probability,
            selectionMode,
            authorizationMode,
            authorizationProbability,
          }) => {
            const selection =
              selectionMode === "deterministic" ? "deterministic" : probability.toFixed(3);
            const authorization =
              authorizationMode === "choice"
                ? "choice"
                : (authorizationProbability?.toFixed(3) ?? "missing");
            return `${step}. ${action.action} ${action.ref} (${action.label}) — selection ${selection}, authorization ${authorization}`;
          },
        )
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `${trace.length} action${trace.length === 1 ? "" : "s"} executed; stopped: ${stopReason}.${summary ? `\n${summary}` : ""}\n\n${finalSnapshot}`,
          },
        ],
        details: { stopReason, trace, finalSnapshot },
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
