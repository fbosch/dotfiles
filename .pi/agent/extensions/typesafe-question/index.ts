import {
  type ClassifierAnswer,
  type ClassifierContext,
  type ClassifierResult,
  type JsonObject,
  type JsonValue,
  StringEnum,
  type Usage,
} from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ModelRegistry } from "@earendil-works/pi-coding-agent";
import { isMatching, match, P } from "ts-pattern";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { type JevGatewayFetch, loadJevClassifierPreferences } from "../../lib/jev-gateway";
import { isRecord } from "../shared/is-record";

const MAX_REQUEST_BYTES = 64_000;
const MAX_RESULT_BYTES = 50_000;
const QUESTION_TIMEOUT_MS = 10_000;
const ID = "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$";
const PROBABILITY_TOLERANCE = 0.02;

const Question = Type.Union([
  Type.Object(
    {
      type: StringEnum(["bool"] as const),
      instructions: Type.String(),
      criteria: Type.Object(
        { true: Type.String(), false: Type.String() },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: StringEnum(["choice"] as const),
      instructions: Type.String(),
      criteria: Type.Record(Type.String({ pattern: ID }), Type.String(), {
        minProperties: 2,
        maxProperties: 32,
        additionalProperties: false,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: StringEnum(["score"] as const),
      instructions: Type.String(),
      criteria: Type.Array(Type.String(), { minItems: 2, maxItems: 10 }),
    },
    { additionalProperties: false },
  ),
]);

export const QuestionParameters = Type.Object(
  {
    state: Type.Record(Type.String(), Type.Unknown()),
    questions: Type.Record(Type.String({ pattern: ID }), Question, {
      minProperties: 1,
      maxProperties: 16,
      additionalProperties: false,
    }),
  },
  { additionalProperties: false },
);

export type JevClassifierRegistry = Pick<ModelRegistry, "findOfType" | "classify">;
interface ClassifyOptions {
  signal?: AbortSignal;
  fetch?: JevGatewayFetch;
  timeoutMs?: number;
  agentDirectory?: string;
}

function assertJson(value: unknown, ancestors = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || value === null || ancestors.has(value))
    throw new Error("Jev input must contain finite, acyclic JSON values");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const child of value) assertJson(child, ancestors);
    } else if (isRecord(value)) {
      for (const child of Object.values(value)) assertJson(child, ancestors);
    } else {
      throw new Error("Jev input must contain only JSON objects and arrays");
    }
  } finally {
    ancestors.delete(value);
  }
}

export function normalizeQuestionInput(value: unknown): ClassifierContext {
  assertJson(value);
  if (!Value.Check(QuestionParameters, value)) throw new Error("Invalid Jev classifier input");
  const state: JsonObject = Object.fromEntries(
    Object.entries(value.state).map(([key, child]) => {
      assertJson(child);
      return [key, child];
    }),
  );
  const input = { state, questions: value.questions };
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_REQUEST_BYTES)
    throw new Error("Jev request exceeds 64 KB");
  return input;
}

const UnitProbability = P.number.finite().between(0, 1);
const Answer = P.union(
  { type: "bool", probability: UnitProbability },
  {
    type: "choice",
    choice: P.string,
    probabilities: P.record(P.string, UnitProbability),
    confidence: UnitProbability,
  },
  { type: "score", score: P.number.finite(), confidence: UnitProbability },
);

export function normalizeQuestionResponse(
  value: unknown,
  input: ClassifierContext,
): Record<string, ClassifierAnswer> {
  if (
    !isRecord(value) ||
    !isRecord(value.answers) ||
    Object.keys(value.answers).length !== Object.keys(input.questions).length
  )
    throw new Error("Invalid Jev answer set");
  const answers: Record<string, ClassifierAnswer> = Object.create(null);
  for (const [id, question] of Object.entries(input.questions)) {
    const answer = value.answers[id];
    if (!isMatching(Answer, answer) || answer.type !== question.type)
      throw new Error(`Invalid Jev answer for ${id}`);
    answers[id] = match(answer)
      .returnType<ClassifierAnswer>()
      .with({ type: "bool" }, ({ probability }) => ({ type: "bool", probability }))
      .with({ type: "choice" }, ({ choice, probabilities, confidence }) => {
        const options = Object.keys(question.criteria);
        const total = Object.values(probabilities).reduce(
          (sum, probability) => sum + probability,
          0,
        );
        if (
          !options.includes(choice) ||
          Object.keys(probabilities).length !== options.length ||
          options.some((option) => !Object.hasOwn(probabilities, option)) ||
          Math.abs(total - 1) > PROBABILITY_TOLERANCE ||
          options.some((option) => (probabilities[option] ?? 0) > (probabilities[choice] ?? 0))
        )
          throw new Error(`Invalid Jev choice for ${id}`);
        return { type: "choice", choice, probabilities, confidence };
      })
      .with({ type: "score" }, ({ score, confidence }) => {
        if (question.type !== "score" || score < 0 || score > question.criteria.length - 1)
          throw new Error(`Invalid Jev score for ${id}`);
        return { type: "score", score, confidence };
      })
      .exhaustive();
  }
  if (Buffer.byteLength(JSON.stringify(answers), "utf8") > MAX_RESULT_BYTES)
    throw new Error("Jev answer exceeds 50 KB");
  return answers;
}

async function withinDeadline<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  // Bound auth resolution too, including providers that do not honor the request signal.
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("Jev deadline exceeded"));
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return run();
      })
      .then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
  });
}

function addUsage(total: Usage | undefined, next: Usage | undefined): Usage | undefined {
  if (!total) return next;
  if (!next) return total;
  return {
    input: total.input + next.input,
    output: total.output + next.output,
    cacheRead: total.cacheRead + next.cacheRead,
    cacheWrite: total.cacheWrite + next.cacheWrite,
    totalTokens: total.totalTokens + next.totalTokens,
    cost: {
      input: total.cost.input + next.cost.input,
      output: total.cost.output + next.cost.output,
      cacheRead: total.cost.cacheRead + next.cost.cacheRead,
      cacheWrite: total.cost.cacheWrite + next.cost.cacheWrite,
      total: total.cost.total + next.cost.total,
    },
  };
}

export async function classifyJevQuestion(
  input: unknown,
  registry: JevClassifierRegistry,
  options: ClassifyOptions = {},
): Promise<{ answers: Record<string, ClassifierAnswer>; usage?: Usage }> {
  const normalized = normalizeQuestionInput(input);
  const preferences = loadJevClassifierPreferences(options.agentDirectory);
  if (!preferences) throw new Error("Jev request failed (configuration: invalid-config)");
  const timeoutMs = options.timeoutMs ?? QUESTION_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid Jev timeout");
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const started = Date.now();
  const requestFetch = options.fetch;
  const fetch = requestFetch
    ? Object.assign((input: RequestInfo | URL, init?: RequestInit) => requestFetch(input, init), {
        preconnect: globalThis.fetch.preconnect,
      })
    : undefined;
  let usage: Usage | undefined;
  for (const [index, preference] of preferences.entries()) {
    if (options.signal?.aborted) throw new Error("Jev request failed (caller-cancellation)");
    if (deadline.aborted) throw new Error("Jev request failed (timeout)");
    const model = registry.findOfType("classifier", preference.provider, preference.model);
    if (!model) continue;
    const remaining = Math.max(1, timeoutMs - (Date.now() - started));
    const budget =
      index === 0 && preferences.length > 1 ? Math.max(1, Math.floor(remaining / 2)) : remaining;
    const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(budget)]);
    let result: ClassifierResult;
    try {
      result = await withinDeadline(
        () =>
          registry.classify(model, normalized, {
            signal: attemptSignal,
            timeoutMs: budget,
            ...(fetch ? { fetch } : {}),
          }),
        attemptSignal,
      );
    } catch {
      continue;
    }
    usage = addUsage(usage, result.usage);
    if (attemptSignal.aborted || result.stopReason !== "stop") continue;
    const answers = normalizeQuestionResponse(result, normalized);
    return { answers, ...(usage ? { usage } : {}) };
  }
  if (options.signal?.aborted) throw new Error("Jev request failed (caller-cancellation)");
  throw new Error(
    `Jev request failed (${deadline.aborted ? "timeout" : "classifier-unavailable"})`,
  );
}

export async function askJevQuestion(
  input: unknown,
  registry: JevClassifierRegistry,
  signal?: AbortSignal,
  fetch?: JevGatewayFetch,
): Promise<Record<string, ClassifierAnswer>> {
  const { answers } = await classifyJevQuestion(input, registry, {
    ...(signal ? { signal } : {}),
    ...(fetch ? { fetch } : {}),
  });
  return answers;
}

export default function typesafeQuestionExtension(pi: ExtensionAPI): void {
  pi.registerTool(
    defineTool({
      name: "typesafe_question",
      label: "TypeSafe question",
      description:
        "Ask Jev up to 16 narrow bool, choice, or score questions about shared JSON object state through Pi's native classifier API. Instructions and criteria must be strings; bool criteria require true and false descriptions. Returns bool probability, choice probabilities/confidence, or score/confidence. Sends all supplied data to the configured Vercel AI Gateway or OpenRouter; do not send secrets or sensitive data. Returns validated judgments, not actions.",
      promptSnippet: "Get typed Jev judgments for narrow semantic decisions",
      promptGuidelines: [
        "Use typesafe_question for routing, classification, scoring, or checking a claim against supplied state when probabilities help; keep exact lookups and calculations in code.",
        "Batch independent questions over the same object state. Use string instructions and criteria; bool is a yes/no probability, while score measures an ordered level. Do not use Jev for prose generation or workflow actions, and do not send secrets or sensitive data.",
        "Treat Jev answers as uncertain judgments, not permission to act; verify consequential decisions against evidence and policy.",
      ],
      parameters: QuestionParameters,
      async execute(_id, params, signal, _update, ctx) {
        const result = await classifyJevQuestion(params, ctx.modelRegistry, {
          ...(signal ? { signal } : {}),
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ answers: result.answers }) }],
          details: { answers: result.answers },
          ...(result.usage ? { usage: result.usage } : {}),
        };
      },
    }),
  );
}
