import { isDeepStrictEqual } from "node:util";
import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ModelRegistry } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { type JevGatewayFetch, requestJevGateway } from "../../lib/jev-gateway";
import { isRecord } from "../shared/is-record";

const MAX_REQUEST_BYTES = 64_000;
const MAX_RESULT_BYTES = 50_000;
const MAX_QUESTIONS = 16;
const QUESTION_TIMEOUT_MS = 10_000;
const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u;
const PROBABILITY_TOLERANCE = 0.02;

const Structured = Type.Union([
  Type.String(),
  Type.Record(Type.String(), Type.Any()),
  Type.Array(Type.Any()),
]);
const Question = Type.Union([
  Type.Object(
    {
      type: StringEnum(["noul"] as const),
      instructions: Structured,
      criteria: Type.Optional(
        Type.Object({ true: Structured, false: Structured }, { additionalProperties: false }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: StringEnum(["choice"] as const),
      instructions: Structured,
      criteria: Type.Record(Type.String(), Type.Union([Structured, Type.Null()]), {
        minProperties: 2,
        maxProperties: 32,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: StringEnum(["score"] as const),
      instructions: Structured,
      criteria: Type.Array(Structured, { minItems: 2, maxItems: 10 }),
    },
    { additionalProperties: false },
  ),
]);

export const QuestionParameters = Type.Object(
  {
    state: Structured,
    questions: Type.Record(Type.String(), Question, {
      minProperties: 1,
      maxProperties: MAX_QUESTIONS,
    }),
  },
  { additionalProperties: false },
);

type QuestionInput = Static<typeof QuestionParameters>;
type NormalizedQuestion = {
  type: "noul" | "choice" | "score";
  instructions: unknown;
  criteria?: unknown;
};
type NormalizedInput = { state: unknown; questions: Record<string, NormalizedQuestion> };

function assertJson(value: unknown, ancestors = new Set<object>()): void {
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

function assertStructured(value: unknown): void {
  if (typeof value !== "string" && !Array.isArray(value) && !isRecord(value)) {
    throw new Error("Jev state, instructions and criteria must be strings, objects or arrays");
  }
  assertJson(value);
}

function assertId(id: string): void {
  if (!ID.test(id))
    throw new Error(
      "Jev question and option names must be 1–64 ASCII letters, digits, underscores or hyphens, starting with a letter",
    );
}

export function normalizeQuestionInput(value: unknown): NormalizedInput {
  if (
    !isRecord(value) ||
    !Object.hasOwn(value, "state") ||
    !isRecord(value.questions) ||
    Object.keys(value).length !== 2
  ) {
    throw new Error("Jev input requires only state and a questions object");
  }
  assertStructured(value.state);
  const entries = Object.entries(value.questions);
  if (entries.length < 1 || entries.length > MAX_QUESTIONS)
    throw new Error("Jev requires 1–16 questions");
  const questions: Record<string, NormalizedQuestion> = Object.create(null);
  for (const [id, raw] of entries) {
    assertId(id);
    if (!isRecord(raw) || !["noul", "choice", "score"].includes(String(raw.type)))
      throw new Error(`Invalid Jev question ${id}`);
    if (Object.keys(raw).some((key) => !["type", "instructions", "criteria"].includes(key)))
      throw new Error(`Unexpected Jev question field in ${id}`);
    assertStructured(raw.instructions);
    if (raw.type === "noul") {
      if (raw.criteria !== undefined) {
        if (!isRecord(raw.criteria) || Object.keys(raw.criteria).sort().join() !== "false,true")
          throw new Error(`Invalid noul criteria for ${id}`);
        assertStructured(raw.criteria.true);
        assertStructured(raw.criteria.false);
      }
    } else if (raw.type === "choice") {
      if (
        !isRecord(raw.criteria) ||
        Object.keys(raw.criteria).length < 2 ||
        Object.keys(raw.criteria).length > 32
      )
        throw new Error(`Choice ${id} requires 2–32 options`);
      for (const [option, description] of Object.entries(raw.criteria)) {
        assertId(option);
        if (description !== null) assertStructured(description);
      }
    } else {
      if (!Array.isArray(raw.criteria) || raw.criteria.length < 2 || raw.criteria.length > 10)
        throw new Error(`Score ${id} requires 2–10 ordered levels`);
      for (const level of raw.criteria) assertStructured(level);
    }
    questions[id] = {
      type: raw.type as NormalizedQuestion["type"],
      instructions: raw.instructions,
      ...(raw.criteria === undefined ? {} : { criteria: raw.criteria }),
    };
  }
  const input = { state: value.state, questions };
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_REQUEST_BYTES)
    throw new Error("Jev request exceeds 64 KB");
  return input;
}

function probability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function distribution(value: unknown, keys: string[]): value is Record<string, number> {
  if (!isRecord(value) || Object.keys(value).length !== keys.length) return false;
  let total = 0;
  for (const key of keys) {
    if (!Object.hasOwn(value, key) || !probability(value[key])) return false;
    total += value[key];
  }
  return Math.abs(total - 1) <= PROBABILITY_TOLERANCE;
}

export function normalizeQuestionResponse(
  value: unknown,
  input: NormalizedInput,
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    !isRecord(value.answers) ||
    Object.keys(value.answers).length !== Object.keys(input.questions).length
  )
    throw new Error("Invalid Jev answer set");
  const answers: Record<string, unknown> = Object.create(null);
  for (const [id, question] of Object.entries(input.questions)) {
    const answer = value.answers[id];
    if (!isRecord(answer) || answer.type !== question.type)
      throw new Error(`Invalid Jev answer for ${id}`);
    if (question.type === "noul") {
      if (!probability(answer.noul)) throw new Error(`Invalid Jev noul for ${id}`);
      answers[id] = { type: "noul", noul: answer.noul };
    } else if (question.type === "choice") {
      const options = Object.keys(question.criteria as Record<string, unknown>);
      if (
        typeof answer.choice !== "string" ||
        !options.includes(answer.choice) ||
        !distribution(answer.probabilities, options) ||
        !probability(answer.confidence)
      )
        throw new Error(`Invalid Jev choice for ${id}`);
      if (
        options.some(
          (option) =>
            ((answer.probabilities as Record<string, number>)[option] ?? 0) >
            ((answer.probabilities as Record<string, number>)[answer.choice as string] ?? 0),
        )
      )
        throw new Error(`Inconsistent Jev choice for ${id}`);
      answers[id] = {
        type: "choice",
        choice: answer.choice,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
      };
    } else {
      const levels = question.criteria as unknown[];
      const keys = levels.map((_, index) => String(index));
      if (
        !distribution(answer.probabilities, keys) ||
        !probability(answer.confidence) ||
        typeof answer.score !== "number" ||
        !Number.isFinite(answer.score) ||
        answer.score < 0 ||
        answer.score > levels.length - 1 ||
        !isRecord(answer.legend) ||
        Object.keys(answer.legend).length !== keys.length
      )
        throw new Error(`Invalid Jev score for ${id}`);
      const expected = keys.reduce(
        (sum, key) =>
          sum + Number(key) * ((answer.probabilities as Record<string, number>)[key] ?? 0),
        0,
      );
      const legend = answer.legend as Record<string, unknown>;
      if (
        Math.abs(answer.score - expected) > PROBABILITY_TOLERANCE * (levels.length - 1) ||
        keys.some(
          (key, index) =>
            !Object.hasOwn(legend, key) || !isDeepStrictEqual(legend[key], levels[index]),
        )
      )
        throw new Error(`Inconsistent Jev score for ${id}`);
      answers[id] = {
        type: "score",
        score: answer.score,
        probabilities: answer.probabilities,
        legend: answer.legend,
        confidence: answer.confidence,
      };
    }
  }
  return answers;
}

export async function askJevQuestion(
  input: unknown,
  registry: Pick<ModelRegistry, "getProviderAuth">,
  signal?: AbortSignal,
  fetch?: JevGatewayFetch,
): Promise<Record<string, unknown>> {
  const normalized = normalizeQuestionInput(input);
  const result = await requestJevGateway(registry, normalized, {
    timeoutMs: QUESTION_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
    ...(fetch === undefined ? {} : { fetch }),
  });
  if (!result.ok) throw new Error(`Jev request failed (${result.provider}: ${result.reason})`);
  signal?.throwIfAborted();
  const answers = normalizeQuestionResponse(result.value, normalized);
  if (Buffer.byteLength(JSON.stringify(answers), "utf8") > MAX_RESULT_BYTES)
    throw new Error("Jev answer exceeds 50 KB");
  return answers;
}

export default function typesafeQuestionExtension(pi: ExtensionAPI): void {
  pi.registerTool(
    defineTool({
      name: "typesafe_question",
      label: "TypeSafe question",
      description:
        "Ask Jev up to 16 narrow noul, choice, or score questions about shared state. Sends the complete supplied state, instructions and criteria to the configured Vercel AI Gateway or OpenRouter; do not send secrets or sensitive data. Returns validated typed answers, not actions.",
      promptSnippet: "Get typed Jev judgments for narrow semantic decisions",
      promptGuidelines: [
        "Use typesafe_question for routing, classification, scoring, or checking a claim against supplied state when probabilities help; keep exact lookups and calculations in code.",
        "Batch independent questions over the same state. Do not use Jev for prose generation or workflow actions, and do not send secrets or sensitive data.",
        "Treat Jev answers as uncertain judgments, not permission to act; verify consequential decisions against evidence and policy.",
      ],
      parameters: QuestionParameters,
      async execute(_id, params: QuestionInput, signal, _update, ctx) {
        const answers = await askJevQuestion(params, ctx.modelRegistry, signal);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ answers }) }],
          details: { answers },
        };
      },
    }),
  );
}
