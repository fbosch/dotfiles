import { type ClassifierAnswer, type ClassifierContext, StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { requestClassifier } from "../../lib/classifier";
import { INACTIVE_SPECIALIST_TOOL } from "../../lib/tool-exposure";
import { type BrowserInteraction, createBrowserBackends } from "./backends";

const DECISION_TIMEOUT_MS = 2_000;
const MAX_PAGE_STATE_CHARS = 24_000;
const MAX_ACTIONS = 20;
const MAX_ACTION_DESCRIPTION_CHARS = 300;
const NO_ACTION = "no_action";
const DEFAULT_STEP_CONFIDENCE = 0.75;
const DEFAULT_RUN_STEPS = 5;
const MAX_RUN_STEPS = 10;
const INTERACTIVE_SNAPSHOT_LINE =
  /^- (button|link|textbox|searchbox|checkbox|radio|combobox) "((?:\\.|[^"\\])*)" \[([^\]]*\bref=(e\d+)[^\]]*)\](?::.*)?$/u;
const DEFAULT_STEP_SAFETY_CONFIDENCE = 0.9;
const CLICKABLE_SNAPSHOT_LINE =
  /^- (?:button|link) "((?:\\.|[^"\\])+)" \[ref=(e\d+)(?:,[^\]]*)?\]$/u;

const BackendParameter = Type.Optional(
  StringEnum(["agent-browser", "chrome", "firefox"] as const, {
    description:
      "Browser backend. Defaults to the session-owned agent-browser CLI using Lightpanda. MCP backends use existing native server connections.",
  }),
);
const TargetParameters = {
  backend: BackendParameter,
  pageId: Type.Optional(
    Type.Integer({
      minimum: 0,
      description:
        "MCP page ID, or Firefox tab index. Omit to use the last page opened by browser_open on this backend.",
    }),
  ),
};
const OpenParameters = Type.Object(
  { backend: BackendParameter, url: Type.String({ minLength: 1, maxLength: 4_096 }) },
  { additionalProperties: false },
);

const SnapshotParameters = Type.Object(
  {
    ...TargetParameters,
    interactiveOnly: Type.Optional(Type.Boolean()),
    includeUrls: Type.Optional(Type.Boolean()),
    selector: Type.Optional(Type.String({ minLength: 1, maxLength: 1_000 })),
  },
  { additionalProperties: false },
);

const ActParameters = Type.Object(
  {
    ...TargetParameters,
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
    ...TargetParameters,
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
    ...TargetParameters,
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
  readonly interaction: BrowserInteraction;
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
  readonly selectionMode: "deterministic" | "classifier";
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

export interface BrowserDecision {
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
}

export function createDecisionRequest(input: DecideInput): ClassifierContext {
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

function browserDecision(answer: ClassifierAnswer | undefined): BrowserDecision | undefined {
  return answer?.type === "choice"
    ? { choice: answer.choice, probabilities: answer.probabilities }
    : undefined;
}

function decodedLabel(label: string): string {
  try {
    const value: unknown = JSON.parse(`"${label}"`);
    if (typeof value === "string") return value;
  } catch {
    throw new Error("Browser snapshot contains an invalid quoted label");
  }
  throw new Error("Browser snapshot contains a non-string label");
}

export function parseClickCandidates(snapshot: string): ClickCandidate[] {
  const candidates: ClickCandidate[] = [];
  for (const line of snapshot.split(/\r?\n/u)) {
    const match = CLICKABLE_SNAPSHOT_LINE.exec(line.trim());
    const label = match?.[1] === undefined ? undefined : decodedLabel(match[1]);
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
    const label = match?.[2] === undefined ? undefined : decodedLabel(match[2]);
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
    const label = match?.[2] === undefined ? undefined : decodedLabel(match[2]);
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
        interaction: { action: "click", target: ref },
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
        interaction: { action, target: ref },
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
          interaction: { action, target: ref, value: input.value },
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
  return inputs.reduce((redacted, input) => {
    if (input.sensitive !== true || input.value.length === 0) return redacted;
    // Native snapshots and page URLs can escape the same supplied value differently.
    const representations = new Set([
      input.value,
      JSON.stringify(input.value).slice(1, -1),
      encodeURIComponent(input.value),
      new URLSearchParams({ value: input.value }).toString().slice("value=".length),
    ]);
    return [...representations]
      .sort((left, right) => right.length - left.length)
      .reduce((text, value) => text.replaceAll(value, `[redacted:${input.name}]`), redacted);
  }, snapshot);
}

export function createRunAuthorizationRequest(
  objective: string,
  pageState: string,
  candidate: RunCandidate,
): ClassifierContext {
  return {
    state: { objective, page_state: pageState, selected_action: candidate.description },
    questions: {
      authorized: {
        type: "bool",
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

export function createStepSafetyRequest(
  objective: string,
  pageState: string,
  candidate: ClickCandidate,
): ClassifierContext {
  return {
    state: { objective, page_state: pageState, selected_action: { ...candidate } },
    questions: {
      navigation_only: {
        type: "bool",
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

export function evaluateStepDecision(
  decision: BrowserDecision,
  candidates: readonly ClickCandidate[],
  confidenceThreshold: number,
): StepDecision {
  const probability = decision.probabilities[decision.choice];
  if (probability === undefined) throw new Error("Classifier omitted selected probability");
  if (decision.choice === NO_ACTION) return { executed: false, reason: "no_action", probability };

  const candidate = candidates.find(({ id }) => id === decision.choice);
  if (candidate === undefined) throw new Error("Classifier selected an unknown browser candidate");
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

function completionKey(candidate: RunCandidate): string {
  // shortcut: MCP refs are snapshot-local, so completion uses labels and input names.
  // Same-labelled controls share completion; replace this when adapters expose stable control identities.
  return JSON.stringify([
    candidate.trace.action,
    candidate.trace.label,
    candidate.trace.input ?? null,
  ]);
}

export default function browserExtension(pi: ExtensionAPI, classify = requestClassifier): void {
  const getBrowser = createBrowserBackends();
  pi.registerTool({
    ...INACTIVE_SPECIALIST_TOOL,
    name: "browser_open",
    executionMode: "sequential",
    label: "Open browser page",
    description:
      "Open a URL on agent-browser, Chrome MCP, or Firefox MCP. Returns the MCP pageId and binds subsequent calls on that backend to the opened page.",
    parameters: OpenParameters,
    async execute(_toolCallId, params: OpenInput, signal, _onUpdate, ctx) {
      const result = await getBrowser(pi, ctx, params, signal).open(params.url);
      return {
        content: [{ type: "text", text: result }],
        details: {},
      };
    },
  });

  pi.registerTool({
    ...INACTIVE_SPECIALIST_TOOL,
    name: "browser_snapshot",
    executionMode: "sequential",
    label: "Snapshot browser page",
    description:
      "Read a bounded browser snapshot with common control refs from agent-browser, Chrome MCP, or Firefox MCP. MCP actions require these refs, not native UIDs.",
    parameters: SnapshotParameters,
    async execute(_toolCallId, params: SnapshotInput, signal, _onUpdate, ctx) {
      const result = await getBrowser(pi, ctx, params, signal).snapshot(params);
      return {
        content: [{ type: "text", text: result }],
        details: {},
      };
    },
  });

  pi.registerTool({
    ...INACTIVE_SPECIALIST_TOOL,
    name: "browser_act",
    executionMode: "sequential",
    label: "Act in browser",
    description:
      "Perform one explicit browser interaction on the selected backend. Use current browser_snapshot refs; for press, target is a key combination.",
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
      const result = await getBrowser(pi, ctx, params, signal).act(params);
      return {
        content: [{ type: "text", text: result }],
        details: {},
      };
    },
  });

  pi.registerTool({
    ...INACTIVE_SPECIALIST_TOOL,
    name: "browser_step",
    label: "Take browser step",
    description:
      "Take one confidence-gated browser step: snapshot the page, use Classifier to choose a clickable candidate and verify it is navigation-only, click it, then return the updated snapshot. Does not execute uncertain or consequential actions.",
    parameters: StepParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params: StepInput, signal, _onUpdate, ctx) {
      const browser = getBrowser(pi, ctx, params, signal);
      const before = await browser.snapshot({ interactiveOnly: false, includeUrls: true });
      const candidates = parseClickCandidates(before);
      if (candidates.length === 0) {
        return {
          content: [{ type: "text", text: `No clickable candidates found.\n\n${before}` }],
          details: { executed: false, reason: "no_action", probability: 1, before },
        };
      }

      const choiceResult = await classify(
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
      if (!choiceResult.ok)
        throw new Error(`Classifier browser step failed: ${choiceResult.reason}`);
      const choice = browserDecision(choiceResult.value.answers.next_action);
      if (choice === undefined)
        throw new Error("Classifier returned an invalid browser step decision");

      let step = evaluateStepDecision(
        choice,
        candidates,
        params.confidenceThreshold ?? DEFAULT_STEP_CONFIDENCE,
      );
      if (step.executed && step.candidate !== undefined) {
        const safetyResult = await classify(
          ctx.modelRegistry,
          createStepSafetyRequest(params.objective, before, step.candidate),
          {
            ...(signal === undefined ? {} : { signal }),
            timeoutMs: DECISION_TIMEOUT_MS,
          },
        );
        if (!safetyResult.ok)
          throw new Error(`Classifier browser safety check failed: ${safetyResult.reason}`);
        const safetyAnswer = safetyResult.value.answers.navigation_only;
        if (safetyAnswer?.type !== "bool") {
          throw new Error("Classifier returned an invalid browser safety decision");
        }
        const safetyProbability = safetyAnswer.probability;
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

      await browser.act({ action: "click", target: step.candidate.ref });
      await browser.settle("click");
      const after = await browser.snapshot({ interactiveOnly: false, includeUrls: true });
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
    ...INACTIVE_SPECIALIST_TOOL,
    name: "browser_run",
    label: "Run browser workflow",
    description:
      "Run a bounded multi-step browser workflow. Explicit inputs with a unique control match run directly; Classifier selects ambiguous or control actions and independently authorizes button and link clicks.",
    parameters: RunParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params: RunInput, signal, _onUpdate, ctx) {
      const browser = getBrowser(pi, ctx, params, signal);
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
        const snapshotResult = await browser.snapshot({
          interactiveOnly: false,
          includeUrls: true,
        });
        const redactedSnapshot = redactSensitiveInputs(snapshotResult, params.inputs);
        const snapshot = redactedSnapshot;
        pageUrl ??= await browser.url();
        const completedOnPage = completedDescriptions.get(pageUrl) ?? [];
        const decisionPageState =
          completedOnPage.length > 0
            ? `${snapshot}\n\nActions already completed on this page:\n${completedOnPage.map((description) => `- ${description}`).join("\n")}`
            : snapshot;
        const candidates = parseRunCandidates(snapshot, params.inputs).filter(
          (candidate) => !completed.has(`${pageUrl}\u0000${completionKey(candidate)}`),
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
          const choiceResult = await classify(
            ctx.modelRegistry,
            createDecisionRequest({
              objective: params.objective,
              pageState: decisionPageState,
              actions: candidates.map(({ id, description }) => ({ id, description })),
            }),
            { ...(signal === undefined ? {} : { signal }), timeoutMs: DECISION_TIMEOUT_MS },
          );
          if (!choiceResult.ok) {
            throw new Error(`Classifier browser run failed: ${choiceResult.reason}`);
          }
          const choice = browserDecision(choiceResult.value.answers.next_action);
          if (choice === undefined)
            throw new Error("Classifier returned an invalid browser run decision");
          const selectedProbability = choice.probabilities[choice.choice];
          if (selectedProbability === undefined)
            throw new Error("Classifier omitted selected probability");
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
            throw new Error("Classifier selected an unknown browser run candidate");
          }
          candidate = selectedCandidate;
          probability = selectedProbability;
          selectionMode = "classifier";
        }

        const cycleKey = `${snapshot}\u0000${candidate.id}`;
        if (seen.has(cycleKey)) {
          stopReason = "cycle";
          break;
        }
        seen.add(cycleKey);

        let authorizationProbability: number | undefined;
        if (candidate.authorization === "independent") {
          const authorizationResult = await classify(
            ctx.modelRegistry,
            createRunAuthorizationRequest(params.objective, decisionPageState, candidate),
            { ...(signal === undefined ? {} : { signal }), timeoutMs: DECISION_TIMEOUT_MS },
          );
          if (!authorizationResult.ok) {
            throw new Error(
              `Classifier browser authorization failed: ${authorizationResult.reason}`,
            );
          }
          const authorizationAnswer = authorizationResult.value.answers.authorized;
          if (authorizationAnswer?.type !== "bool") {
            throw new Error("Classifier returned an invalid browser authorization decision");
          }
          const authorizedProbability = authorizationAnswer.probability;
          authorizationProbability = authorizedProbability;
          if (authorizedProbability < authorizationThreshold) {
            stopReason = "unauthorized_or_uncertain";
            break;
          }
        }

        try {
          await browser.act(candidate.interaction);
        } catch (error) {
          throw new Error(
            redactSensitiveInputs(
              error instanceof Error ? error.message : String(error),
              params.inputs,
            ),
          );
        }
        completed.add(`${pageUrl}\u0000${completionKey(candidate)}`);
        completedDescriptions.set(pageUrl, [...completedOnPage, candidate.description]);
        await browser.settle(candidate.trace.action);
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
        await browser.snapshot({ interactiveOnly: false, includeUrls: true }),
        params.inputs,
      );
      const lastTrace = trace.at(-1);
      if (lastTrace?.action.action === "click" && finalSnapshot === lastTrace.snapshot) {
        await browser.settle("click", true);
        finalSnapshot = redactSensitiveInputs(
          await browser.snapshot({ interactiveOnly: false, includeUrls: true }),
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
    ...INACTIVE_SPECIALIST_TOOL,
    name: "browser_decide",
    label: "Choose browser action",
    description:
      "Ask Classifier to choose among explicit candidate browser actions using a bounded page snapshot. This is advisory and never executes the action.",
    parameters: DecideParameters,
    async execute(_toolCallId, params: DecideInput, signal, _onUpdate, ctx) {
      const ids = params.actions.map((action) => action.id);
      if (new Set(ids).size !== ids.length || ids.includes(NO_ACTION)) {
        throw new Error(`Action ids must be unique and must not use reserved id ${NO_ACTION}`);
      }

      const decisionResult = await classify(ctx.modelRegistry, createDecisionRequest(params), {
        ...(signal === undefined ? {} : { signal }),
        timeoutMs: DECISION_TIMEOUT_MS,
      });
      if (!decisionResult.ok) {
        throw new Error(`Classifier browser decision failed: ${decisionResult.reason}`);
      }

      const decision = browserDecision(decisionResult.value.answers.next_action);
      if (decision === undefined)
        throw new Error("Classifier returned an invalid browser decision");
      const selectedProbability = decision.probabilities[decision.choice];
      if (selectedProbability === undefined)
        throw new Error("Classifier omitted selected probability");
      const text =
        decision.choice === NO_ACTION
          ? `No action selected (${selectedProbability.toFixed(3)})`
          : `Selected ${decision.choice} (${selectedProbability.toFixed(3)})`;
      return { content: [{ type: "text", text }], details: decision };
    },
  });
}
