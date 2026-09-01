import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

interface AskOption {
  label: string;
  value: string;
  description?: string;
}

interface TextAnswer {
  type: "text";
  label: string;
  value: string;
}

interface OptionAnswer {
  type: "option";
  label: string;
  value: string;
  index: number;
}

interface OtherAnswer {
  type: "other";
  label: string;
  value: string;
}

type AskAnswer = TextAnswer | OptionAnswer | OtherAnswer;
type AskUserQuestionStatus = "answered" | "cancelled" | "unavailable";
type AskUserQuestionMode = "text" | "single-select" | "multi-select";

export interface AskUserQuestionResultDetails {
  status: AskUserQuestionStatus;
  question: string;
  context?: string;
  mode: AskUserQuestionMode;
  answers: AskAnswer[];
  message?: string;
}

// Pi expects TypeBox-compatible schema metadata; keep the schema local rather than relying on
// TypeBox through Pi's transitive dependencies.
const OptionSchema = {
  "~kind": "Object" as const,
  type: "object" as const,
  required: ["label"] as const,
  properties: {
    label: {
      "~kind": "String" as const,
      type: "string" as const,
      description:
        'Display label for the option. Put a recommended option first and append "(Recommended)".',
    },
    value: {
      "~kind": "String" as const,
      "~optional": true as const,
      type: "string" as const,
      description: "Optional machine-readable value. Defaults to the display label.",
    },
    description: {
      "~kind": "String" as const,
      "~optional": true as const,
      type: "string" as const,
      description: "Optional detail shown with the option.",
    },
  },
};

const AskUserQuestionParams = {
  "~kind": "Object" as const,
  type: "object" as const,
  required: ["question"] as const,
  properties: {
    question: {
      "~kind": "String" as const,
      type: "string" as const,
      description: "The single question to ask. Ask exactly one question per tool call.",
    },
    details: {
      "~kind": "String" as const,
      "~optional": true as const,
      type: "string" as const,
      description: "Optional context or instructions shown under the question.",
    },
    options: {
      "~kind": "Array" as const,
      "~optional": true as const,
      type: "array" as const,
      items: OptionSchema,
      description:
        "Optional choices. Omit or pass an empty array for free-form input. A custom Other answer is always available when choices are provided.",
    },
    multiSelect: {
      "~kind": "Boolean" as const,
      "~optional": true as const,
      type: "boolean" as const,
      description: "Allow more than one choice for this question.",
    },
  },
};

interface SharedUILock {
  withLock<T>(operation: () => T | Promise<T>, signal?: AbortSignal): Promise<T | undefined>;
}

const sharedGlobal = globalThis as typeof globalThis & {
  __piSharedUiLock?: SharedUILock;
};

function getSharedUILock(): SharedUILock {
  if (sharedGlobal.__piSharedUiLock !== undefined) return sharedGlobal.__piSharedUiLock;

  let chain = Promise.resolve();
  const lock: SharedUILock = {
    withLock<T>(operation: () => T | Promise<T>, signal?: AbortSignal): Promise<T | undefined> {
      const previous = chain;
      let release: () => void = () => {};
      chain = new Promise<void>((resolve) => {
        release = resolve;
      });

      return new Promise<T | undefined>((resolve, reject) => {
        let started = false;
        let cancelled = signal?.aborted === true;
        const handleAbort = () => {
          cancelled = true;
          if (started === false) resolve(undefined);
        };
        const cleanup = () => signal?.removeEventListener("abort", handleAbort);

        if (cancelled) {
          resolve(undefined);
        } else {
          signal?.addEventListener("abort", handleAbort, { once: true });
        }

        void previous.then(async () => {
          started = true;
          if (cancelled) {
            cleanup();
            release();
            return;
          }

          try {
            const result = await operation();
            resolve(signal?.aborted === true ? undefined : result);
          } catch (error) {
            reject(error);
          } finally {
            cleanup();
            release();
          }
        });
      });
    },
  };

  sharedGlobal.__piSharedUiLock = lock;
  return lock;
}

const sharedUILock = getSharedUILock();

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function normalizeOptions(
  options: Array<{ label: string; value?: string; description?: string }> | undefined,
): AskOption[] {
  return (options ?? [])
    .map((option) => {
      const label = option.label.trim();
      const description = option.description?.trim();
      return {
        label,
        value: option.value?.trim() || label,
        ...(description ? { description } : {}),
      };
    })
    .filter((option) => option.label.length > 0);
}

function questionTitle(question: string, context: string | undefined): string {
  return context === undefined ? question : `${question}\n\n${context}`;
}

function optionLabel(option: AskOption, index: number, selected?: boolean): string {
  const marker = selected === undefined ? "" : selected ? "[x] " : "[ ] ";
  const description = option.description === undefined ? "" : ` — ${option.description}`;
  return `${marker}${index + 1}. ${option.label}${description}`;
}

function otherLabel(options: AskOption[]): string {
  return options.some((option) => option.label.toLowerCase() === "other")
    ? "Other (custom)"
    : "Other";
}

function formatAnswer(answer: AskAnswer): string {
  if (answer.type === "option") return `${answer.index}. ${answer.label}`;
  if (answer.type === "other") return `Other: ${answer.label}`;
  return answer.label;
}

function resultDetails(
  status: AskUserQuestionStatus,
  question: string,
  mode: AskUserQuestionMode,
  answers: AskAnswer[],
  context?: string,
  message?: string,
): AskUserQuestionResultDetails {
  return {
    status,
    question,
    mode,
    answers,
    ...(context === undefined ? {} : { context }),
    ...(message === undefined ? {} : { message }),
  };
}

function cancelledResult(question: string, mode: AskUserQuestionMode, context?: string) {
  const message = "User cancelled the question";
  return {
    content: [{ type: "text" as const, text: message }],
    details: resultDetails("cancelled", question, mode, [], context, message),
  };
}

function unavailableResult(question: string, mode: AskUserQuestionMode, context?: string) {
  const message = "ask_user_question requires an interactive UI";
  return {
    content: [{ type: "text" as const, text: message }],
    details: resultDetails("unavailable", question, mode, [], context, message),
  };
}

function answeredResult(
  question: string,
  mode: AskUserQuestionMode,
  answers: AskAnswer[],
  context?: string,
) {
  let text: string;
  if (mode === "text") {
    text = answers[0]?.label
      ? `User answered: ${answers[0].label}`
      : "User submitted an empty response";
  } else if (mode === "single-select") {
    const answer = answers[0];
    text =
      answer === undefined ? "User selected no answer" : `User selected: ${formatAnswer(answer)}`;
  } else {
    text = `User selected:\n${answers.map((answer) => `- ${formatAnswer(answer)}`).join("\n")}`;
  }

  return {
    content: [{ type: "text" as const, text }],
    details: resultDetails("answered", question, mode, answers, context),
  };
}

async function askSingleChoice(
  ctx: ExtensionContext,
  title: string,
  options: AskOption[],
  signal: AbortSignal | undefined,
): Promise<AskAnswer | undefined> {
  const customLabel = otherLabel(options);
  const displayedOptions = options.map((option, index) => optionLabel(option, index));
  const dialogOptions = signal === undefined ? undefined : { signal };

  while (isAborted(signal) === false) {
    const selected = await ctx.ui.select(title, [...displayedOptions, customLabel], dialogOptions);
    if (selected === undefined || isAborted(signal)) return undefined;

    const selectedIndex = displayedOptions.indexOf(selected);
    if (selectedIndex >= 0) {
      const option = options[selectedIndex];
      if (option === undefined) return undefined;
      return {
        type: "option",
        label: option.label,
        value: option.value,
        index: selectedIndex + 1,
      };
    }

    const customAnswer = await ctx.ui.input(
      `${title}\n\nWrite your custom answer:`,
      "Type your answer",
      dialogOptions,
    );
    if (isAborted(signal)) return undefined;
    if (customAnswer === undefined) continue;

    const trimmed = customAnswer.trim();
    if (trimmed.length > 0) return { type: "other", label: trimmed, value: trimmed };

    ctx.ui.notify("Enter a custom answer or cancel to return to the choices.", "warning");
  }

  return undefined;
}

async function askMultipleChoice(
  ctx: ExtensionContext,
  title: string,
  options: AskOption[],
  signal: AbortSignal | undefined,
): Promise<AskAnswer[] | undefined> {
  const selectedOptions = new Map<number, OptionAnswer>();
  let customAnswer: OtherAnswer | undefined;
  const dialogOptions = signal === undefined ? undefined : { signal };

  while (isAborted(signal) === false) {
    const displayedOptions = options.map((option, index) =>
      optionLabel(option, index, selectedOptions.has(index)),
    );
    const customDisplay = `${customAnswer === undefined ? "[ ]" : "[x]"} ${otherLabel(options)}${
      customAnswer === undefined ? "" : ` — ${customAnswer.label}`
    }`;
    const answerCount = selectedOptions.size + (customAnswer === undefined ? 0 : 1);
    const submitDisplay = `Submit (${answerCount} selected)`;
    const selected = await ctx.ui.select(
      title,
      [...displayedOptions, customDisplay, submitDisplay],
      dialogOptions,
    );

    if (selected === undefined || isAborted(signal)) return undefined;
    if (selected === submitDisplay) {
      if (answerCount === 0) {
        ctx.ui.notify("Select at least one answer before submitting.", "warning");
        continue;
      }

      const answers: AskAnswer[] = [...selectedOptions.values()].sort(
        (left, right) => left.index - right.index,
      );
      if (customAnswer !== undefined) answers.push(customAnswer);
      return answers;
    }

    if (selected === customDisplay) {
      const answer = await ctx.ui.input(
        `${title}\n\nCustom answer (submit an empty value to clear it):`,
        customAnswer?.label ?? "Type your answer",
        dialogOptions,
      );
      if (isAborted(signal)) return undefined;
      if (answer === undefined) continue;

      const trimmed = answer.trim();
      customAnswer =
        trimmed.length === 0 ? undefined : { type: "other", label: trimmed, value: trimmed };
      continue;
    }

    const selectedIndex = displayedOptions.indexOf(selected);
    if (selectedIndex < 0) continue;

    if (selectedOptions.has(selectedIndex)) {
      selectedOptions.delete(selectedIndex);
      continue;
    }

    const option = options[selectedIndex];
    if (option === undefined) continue;
    selectedOptions.set(selectedIndex, {
      type: "option",
      label: option.label,
      value: option.value,
      index: selectedIndex + 1,
    });
  }

  return undefined;
}

export default function askUserQuestion(pi: ExtensionAPI): void {
  pi.registerTool(
    defineTool<typeof AskUserQuestionParams, AskUserQuestionResultDetails>({
      name: "ask_user_question",
      label: "Ask user question",
      description:
        "Ask the user one question and pause until they answer. Use this instead of guessing when requirements, preferences, or materially different implementation choices are unclear.",
      promptSnippet: "Ask one blocking clarification or decision question",
      promptGuidelines: [
        "Use ask_user_question instead of guessing when missing information materially affects the result.",
        "Ask exactly one question per ask_user_question call; use separate calls for unrelated questions.",
        "When recommending an option in ask_user_question, put it first and append (Recommended) to its label.",
      ],
      parameters: AskUserQuestionParams,
      executionMode: "sequential",

      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const options = normalizeOptions(params.options);
        const context = params.details?.trim() || undefined;
        const mode: AskUserQuestionMode =
          options.length === 0
            ? "text"
            : params.multiSelect === true
              ? "multi-select"
              : "single-select";

        if (isAborted(signal)) return cancelledResult(params.question, mode, context);
        if (ctx.hasUI === false) return unavailableResult(params.question, mode, context);

        const result = await sharedUILock.withLock(async () => {
          const title = questionTitle(params.question, context);
          if (mode === "text") {
            const dialogOptions = signal === undefined ? undefined : { signal };
            const answer = await ctx.ui.input(title, "Type your answer", dialogOptions);
            if (answer === undefined || isAborted(signal)) {
              return cancelledResult(params.question, mode, context);
            }

            const trimmed = answer.trim();
            return answeredResult(
              params.question,
              mode,
              [{ type: "text", label: trimmed, value: trimmed }],
              context,
            );
          }

          if (mode === "single-select") {
            const answer = await askSingleChoice(ctx, title, options, signal);
            if (answer === undefined) return cancelledResult(params.question, mode, context);
            return answeredResult(params.question, mode, [answer], context);
          }

          const answers = await askMultipleChoice(ctx, title, options, signal);
          if (answers === undefined) return cancelledResult(params.question, mode, context);
          return answeredResult(params.question, mode, answers, context);
        }, signal);

        return result ?? cancelledResult(params.question, mode, context);
      },

      renderCall(args, theme) {
        const suffix = args.multiSelect === true ? theme.fg("dim", " [multi-select]") : "";
        return new Text(
          `${theme.fg("toolTitle", theme.bold("ask_user_question "))}${theme.fg("muted", args.question)}${suffix}`,
          0,
          0,
        );
      },

      renderResult(result, _options, theme) {
        const details = result.details;
        if (details.status !== "answered") {
          return new Text(theme.fg("warning", details.message ?? details.status), 0, 0);
        }

        return new Text(
          details.answers
            .map(
              (answer) => `${theme.fg("success", "✓ ")}${theme.fg("accent", formatAnswer(answer))}`,
            )
            .join("\n"),
          0,
          0,
        );
      },
    }),
  );
}
