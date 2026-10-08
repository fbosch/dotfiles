import {
  type ClassifierAnswer,
  type ClassifierContext,
  type JsonObject,
  StringEnum,
  type Usage,
} from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  assertClassifierJson,
  type ClassifierFetch,
  type ClassifierRegistry,
  createClassifierRequester,
  INTERACTIVE_CLASSIFIER_TIMEOUT_MS,
  normalizeClassifierAnswers,
  requestClassifier,
} from "../../lib/classifier";

export type { ClassifierRegistry } from "../../lib/classifier";

const MAX_REQUEST_BYTES = 64_000;
const MAX_RESULT_BYTES = 50_000;
const ID = "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$";

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

interface ClassifyOptions {
  signal?: AbortSignal;
  fetch?: ClassifierFetch;
  timeoutMs?: number;
  agentDirectory?: string;
}

class ClassifierQuestionError extends Error {
  constructor(
    message: string,
    readonly usage: Usage | undefined,
  ) {
    super(message);
  }
}

export function normalizeQuestionInput(value: unknown): ClassifierContext {
  assertClassifierJson(value);
  if (!Value.Check(QuestionParameters, value)) throw new Error("Invalid classifier input");
  const state: JsonObject = Object.fromEntries(
    Object.entries(value.state).map(([key, child]) => {
      assertClassifierJson(child);
      return [key, child];
    }),
  );
  const input = { state, questions: value.questions };
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_REQUEST_BYTES)
    throw new Error("Classifier request exceeds 64 KB");
  return input;
}

export function normalizeQuestionResponse(
  value: unknown,
  input: ClassifierContext,
): Record<string, ClassifierAnswer> {
  const answers = normalizeClassifierAnswers(value, input);
  if (Buffer.byteLength(JSON.stringify(answers), "utf8") > MAX_RESULT_BYTES)
    throw new Error("Classifier answer exceeds 50 KB");
  return answers;
}

export async function classifyQuestion(
  input: unknown,
  registry: ClassifierRegistry,
  options: ClassifyOptions = {},
): Promise<{ answers: Record<string, ClassifierAnswer>; usage?: Usage }> {
  const normalized = normalizeQuestionInput(input);
  const timeoutMs = options.timeoutMs ?? INTERACTIVE_CLASSIFIER_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid Classifier timeout");
  const request =
    options.agentDirectory === undefined
      ? requestClassifier
      : createClassifierRequester(Date.now, options.agentDirectory);
  const result = await request(registry, normalized, {
    timeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  if (!result.ok) {
    const reason =
      result.reason === "model-unavailable" || result.reason === "auth-failure"
        ? "classifier-unavailable"
        : result.reason;
    throw new ClassifierQuestionError(
      `Classifier request failed (${result.stage}: ${reason})`,
      result.usage,
    );
  }
  try {
    const answers = normalizeQuestionResponse(result.value, normalized);
    return { answers, ...(result.usage ? { usage: result.usage } : {}) };
  } catch {
    throw new ClassifierQuestionError(
      "Classifier request failed (body: invalid-response)",
      result.usage,
    );
  }
}

export async function askClassifierQuestion(
  input: unknown,
  registry: ClassifierRegistry,
  signal?: AbortSignal,
  fetch?: ClassifierFetch,
): Promise<Record<string, ClassifierAnswer>> {
  const { answers } = await classifyQuestion(input, registry, {
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
        "Ask the classifier up to 16 narrow bool, choice, or score questions about shared JSON object state through Pi's native classifier API. Instructions and criteria must be strings; bool criteria require true and false descriptions. Returns bool probability, choice probabilities/confidence, or score/confidence. Sends all supplied data to the configured Vercel AI Gateway or OpenRouter; do not send secrets or sensitive data. Returns validated judgments, not actions.",
      promptSnippet: "Get typed classifier judgments for narrow semantic decisions",
      promptGuidelines: [
        "Use typesafe_question for routing, classification, scoring, or checking a claim against supplied state when probabilities help; keep exact lookups and calculations in code.",
        "Batch independent questions over the same object state. Use string instructions and criteria; bool is a yes/no probability, while score measures an ordered level. Do not use the classifier for prose generation or workflow actions, and do not send secrets or sensitive data.",
        "Treat classifier answers as uncertain judgments, not permission to act; verify consequential decisions against evidence and policy.",
      ],
      parameters: QuestionParameters,
      async execute(_id, params, signal, _update, ctx) {
        try {
          const result = await classifyQuestion(params, ctx.modelRegistry, {
            ...(signal ? { signal } : {}),
          });
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ answers: result.answers }) }],
            details: { answers: result.answers },
            ...(result.usage ? { usage: result.usage } : {}),
          };
        } catch (error) {
          if (!(error instanceof ClassifierQuestionError)) throw error;
          // Returning a tool error preserves billed usage; throwing would discard it.
          return {
            content: [{ type: "text" as const, text: error.message }],
            details: { answers: {}, failure: error.message },
            isError: true,
            ...(error.usage ? { usage: error.usage } : {}),
          };
        }
      },
    }),
  );
}
