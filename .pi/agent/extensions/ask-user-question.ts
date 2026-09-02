import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Input,
  matchesKey,
  Text,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

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

export interface AskUserQuestionInput {
  question: string;
  details?: string;
  options?: Array<{ label: string; value?: string; description?: string }>;
  multiSelect?: boolean;
}

export interface AskUserQuestionRuntimeOptions {
  includeOther?: boolean;
}

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

interface QuestionPromptTheme {
  fg(color: string, text: string): string;
}

type QuestionPromptKeybindings = Pick<KeybindingsManager, "getKeys" | "matches">;

type QuestionPromptStep = "choices" | "input";
type QuestionChoiceKind = "option" | "other" | "submit";

interface QuestionChoiceRow {
  kind: QuestionChoiceKind;
  hotkey?: string;
  label: string;
  description?: string;
  selected: boolean;
}

const OPTION_HOTKEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

class QuestionPromptComponent implements Component {
  private highlightedIndex = 0;
  private readonly selectedOptions = new Map<number, OptionAnswer>();
  private customAnswer: OtherAnswer | undefined;
  private step: QuestionPromptStep;
  private input: Input;
  private error: string | undefined;

  constructor(
    private readonly theme: QuestionPromptTheme,
    private readonly question: string,
    private readonly context: string | undefined,
    private readonly mode: AskUserQuestionMode,
    private readonly options: AskOption[],
    private readonly includeOther: boolean,
    private readonly keybindings: QuestionPromptKeybindings,
    private readonly requestRender: () => void,
    private readonly done: (answers: AskAnswer[] | undefined) => void,
  ) {
    this.step = mode === "text" ? "input" : "choices";
    this.input = this.createInput();
  }

  invalidate(): void {
    // Rendering is derived directly from the current prompt state.
  }

  render(width: number): string[] {
    const lines = this.renderHeader(width);
    if (this.step === "input") {
      const label = this.mode === "text" ? "Answer:" : "Custom answer:";
      lines.push(label, ...this.input.render(width));
      if (this.error !== undefined) {
        lines.push(...wrapTextWithAnsi(this.theme.fg("error", this.error), width));
      }
      lines.push("");
      lines.push(
        ...wrapTextWithAnsi(
          this.theme.fg(
            "muted",
            this.mode === "text" ? "enter submit · esc cancel" : "enter save · esc back",
          ),
          width,
        ),
      );
      return lines;
    }

    const rows = this.choiceRows();
    lines.push(
      this.theme.fg("muted", this.mode === "multi-select" ? "Choose one or more" : "Choose one"),
      "",
    );
    for (const [index, row] of rows.entries()) {
      if (row.kind === "submit") lines.push("");
      lines.push(...this.renderChoiceRow(row, index === this.highlightedIndex, width));
    }
    if (this.error !== undefined) {
      lines.push(...wrapTextWithAnsi(this.theme.fg("error", this.error), width));
    }
    lines.push("");
    lines.push(
      ...wrapTextWithAnsi(
        this.theme.fg(
          "muted",
          this.mode === "multi-select"
            ? `${this.navigationHint()} · space/${this.keyHint("tui.select.confirm")} toggle · 1–9 toggle · s submit · ${this.keyHint("tui.select.cancel")} cancel`
            : `${this.navigationHint()} · 1–9 choose · ${this.keyHint("tui.select.confirm")} select · ${this.keyHint("tui.select.cancel")} cancel`,
        ),
        width,
      ),
    );
    return lines;
  }

  handleInput(data: string): void {
    if (this.step === "input") {
      this.input.handleInput(data);
      this.requestRender();
      return;
    }
    const optionIndex = OPTION_HOTKEYS.findIndex(
      (hotkey, index) => index < this.options.length && matchesKey(data, hotkey),
    );
    if (optionIndex >= 0) {
      this.highlightedIndex = optionIndex;
      this.error = undefined;
      this.chooseOption(optionIndex);
      return;
    }
    if (this.includeOther && matchesKey(data, "o")) {
      this.highlightedIndex = this.options.length;
      this.openCustomAnswer();
      return;
    }
    if (this.mode === "multi-select" && matchesKey(data, "s")) {
      this.highlightedIndex = this.choiceRows().length - 1;
      this.submitChoices();
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up") || matchesKey(data, "k")) {
      this.moveHighlight(-1);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down") || matchesKey(data, "j")) {
      this.moveHighlight(1);
      return;
    }
    if (
      this.keybindings.matches(data, "tui.select.confirm") ||
      (this.mode === "multi-select" && matchesKey(data, "space"))
    ) {
      this.chooseHighlighted();
      return;
    }
    if (this.keybindings.matches(data, "tui.select.cancel")) this.done(undefined);
  }

  private navigationHint(): string {
    const up = this.keybindings.getKeys("tui.select.up").map(displayKey).join("/");
    const down = this.keybindings.getKeys("tui.select.down").map(displayKey).join("/");
    return `${up} ${down} move`;
  }

  private keyHint(binding: "tui.select.cancel" | "tui.select.confirm"): string {
    return this.keybindings.getKeys(binding).map(displayKey).join("/");
  }

  private createInput(value = ""): Input {
    const input = new Input();
    input.focused = true;
    input.setValue(value);
    input.onSubmit = (answer) => this.submitInput(answer);
    input.onEscape = () => this.cancelInput();
    return input;
  }

  private renderHeader(width: number): string[] {
    const lines = wrapTextWithAnsi(this.theme.fg("accent", this.question), width);
    if (this.context !== undefined) {
      lines.push("", ...wrapTextWithAnsi(this.context, width));
    }
    lines.push("");
    return lines;
  }

  private choiceRows(): QuestionChoiceRow[] {
    const rows: QuestionChoiceRow[] = this.options.map((option, index) => {
      return {
        kind: "option",
        ...(OPTION_HOTKEYS[index] === undefined ? {} : { hotkey: OPTION_HOTKEYS[index] }),
        label: option.label,
        ...(option.description === undefined ? {} : { description: option.description }),
        selected: this.selectedOptions.has(index),
      };
    });
    if (this.includeOther) {
      rows.push({
        kind: "other",
        hotkey: "o",
        label: otherLabel(this.options),
        ...(this.customAnswer === undefined ? {} : { description: this.customAnswer.label }),
        selected: this.customAnswer !== undefined,
      });
    }
    if (this.mode === "multi-select") {
      const count = this.answerCount();
      rows.push({
        kind: "submit",
        hotkey: "s",
        label: `Submit · ${count} ${count === 1 ? "selection" : "selections"}`,
        selected: false,
      });
    }
    return rows;
  }

  private renderChoiceRow(row: QuestionChoiceRow, highlighted: boolean, width: number): string[] {
    const marker = highlighted ? this.theme.fg("accent", "▶") : " ";
    const hotkey = row.hotkey === undefined ? "   " : this.theme.fg("muted", `(${row.hotkey})`);
    const checkbox =
      this.mode === "multi-select" && row.kind !== "submit"
        ? `${this.theme.fg(row.selected ? "success" : "muted", row.selected ? "[x]" : "[ ]")} `
        : "";
    const label =
      row.kind === "submit"
        ? this.theme.fg("success", row.label)
        : highlighted
          ? this.theme.fg("accent", row.label)
          : row.label;
    const prefix = `${marker} ${hotkey} ${checkbox}`;
    const prefixWidth = visibleWidth(prefix);
    const lines =
      width <= prefixWidth
        ? wrapTextWithAnsi(`${prefix}${label}`, Math.max(1, width))
        : wrapTextWithAnsi(label, width - prefixWidth).map(
            (line, index) => `${index === 0 ? prefix : " ".repeat(prefixWidth)}${line}`,
          );
    if (row.description !== undefined) {
      const indent = this.mode === "multi-select" ? "          " : "      ";
      const description = this.theme.fg("muted", row.description);
      lines.push(
        ...(width <= indent.length
          ? wrapTextWithAnsi(description, Math.max(1, width))
          : wrapTextWithAnsi(description, width - indent.length).map((line) => `${indent}${line}`)),
      );
    }
    return lines;
  }

  private moveHighlight(direction: -1 | 1): void {
    const count = this.choiceRows().length;
    this.highlightedIndex = (this.highlightedIndex + direction + count) % count;
    this.error = undefined;
    this.requestRender();
  }

  private chooseHighlighted(): void {
    this.error = undefined;
    if (this.highlightedIndex < this.options.length) {
      this.chooseOption(this.highlightedIndex);
      return;
    }
    if (this.includeOther && this.highlightedIndex === this.options.length) {
      this.openCustomAnswer();
      return;
    }
    this.submitChoices();
  }

  private openCustomAnswer(): void {
    this.error = undefined;
    this.step = "input";
    this.input = this.createInput(this.customAnswer?.label);
    this.requestRender();
  }

  private submitChoices(): void {
    this.error = undefined;
    if (this.answerCount() === 0) {
      this.error = "Select at least one answer before submitting.";
      this.requestRender();
      return;
    }

    const answers: AskAnswer[] = [...this.selectedOptions.values()].sort(
      (left, right) => left.index - right.index,
    );
    if (this.customAnswer !== undefined) answers.push(this.customAnswer);
    this.done(answers);
  }

  private chooseOption(index: number): void {
    const option = this.options[index];
    if (option === undefined) return;
    const answer: OptionAnswer = {
      type: "option",
      label: option.label,
      value: option.value,
      index: index + 1,
    };
    if (this.mode === "single-select") {
      this.done([answer]);
      return;
    }
    if (this.selectedOptions.has(index)) {
      this.selectedOptions.delete(index);
    } else {
      this.selectedOptions.set(index, answer);
    }
    this.requestRender();
  }

  private submitInput(answer: string): void {
    const trimmed = answer.trim();
    if (this.mode === "text") {
      this.done([{ type: "text", label: trimmed, value: trimmed }]);
      return;
    }
    if (this.mode === "single-select" && trimmed.length === 0) {
      this.error = "Enter a custom answer or press escape to return to the choices.";
      this.requestRender();
      return;
    }

    this.customAnswer =
      trimmed.length === 0 ? undefined : { type: "other", label: trimmed, value: trimmed };
    if (this.mode === "single-select") {
      this.done(this.customAnswer === undefined ? undefined : [this.customAnswer]);
      return;
    }
    this.step = "choices";
    this.error = undefined;
    this.requestRender();
  }

  private cancelInput(): void {
    if (this.mode === "text") {
      this.done(undefined);
      return;
    }
    this.step = "choices";
    this.error = undefined;
    this.requestRender();
  }

  private answerCount(): number {
    return this.selectedOptions.size + (this.customAnswer === undefined ? 0 : 1);
  }
}

async function askInline(
  ctx: ExtensionContext,
  question: string,
  context: string | undefined,
  mode: AskUserQuestionMode,
  options: AskOption[],
  includeOther: boolean,
  signal: AbortSignal | undefined,
): Promise<AskAnswer[] | undefined> {
  if (isAborted(signal)) return undefined;

  return ctx.ui.custom<AskAnswer[] | undefined>(
    (tui, theme, keybindings, done) => {
      let finished = false;
      const finish = (answers: AskAnswer[] | undefined) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", handleAbort);
        done(answers);
      };
      const handleAbort = () => finish(undefined);
      signal?.addEventListener("abort", handleAbort, { once: true });

      const component = new QuestionPromptComponent(
        theme,
        question,
        context,
        mode,
        options,
        includeOther,
        keybindings,
        () => tui.requestRender(),
        finish,
      );
      if (signal?.aborted === true) queueMicrotask(handleAbort);
      return component;
    },
    { overlay: false },
  );
}

function displayKey(key: string): string {
  if (key === "up") return "↑";
  if (key === "down") return "↓";
  if (key === "escape") return "esc";
  return key;
}

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
  includeOther: boolean,
  signal: AbortSignal | undefined,
): Promise<AskAnswer | undefined> {
  const customLabel = otherLabel(options);
  const displayedOptions = options.map((option, index) => optionLabel(option, index));
  const choices = includeOther ? [...displayedOptions, customLabel] : displayedOptions;
  const dialogOptions = signal === undefined ? undefined : { signal };

  while (isAborted(signal) === false) {
    const selected = await ctx.ui.select(title, choices, dialogOptions);
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

    if (!includeOther || selected !== customLabel) return undefined;

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
  includeOther: boolean,
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
    const choices = includeOther
      ? [...displayedOptions, customDisplay, submitDisplay]
      : [...displayedOptions, submitDisplay];
    const selected = await ctx.ui.select(title, choices, dialogOptions);

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

    if (includeOther && selected === customDisplay) {
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

export async function runAskUserQuestion(
  params: AskUserQuestionInput,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
  runtimeOptions: AskUserQuestionRuntimeOptions = {},
): Promise<
  | ReturnType<typeof answeredResult>
  | ReturnType<typeof cancelledResult>
  | ReturnType<typeof unavailableResult>
> {
  const options = normalizeOptions(params.options);
  const context = params.details?.trim() || undefined;
  const includeOther = runtimeOptions.includeOther ?? true;
  const mode: AskUserQuestionMode =
    options.length === 0 ? "text" : params.multiSelect === true ? "multi-select" : "single-select";

  if (isAborted(signal)) return cancelledResult(params.question, mode, context);
  if (ctx.hasUI === false) return unavailableResult(params.question, mode, context);

  const result = await sharedUILock.withLock(async () => {
    if (ctx.mode === "tui") {
      const answers = await askInline(
        ctx,
        params.question,
        context,
        mode,
        options,
        includeOther,
        signal,
      );
      if (answers === undefined) return cancelledResult(params.question, mode, context);
      return answeredResult(params.question, mode, answers, context);
    }

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
      const answer = await askSingleChoice(ctx, title, options, includeOther, signal);
      if (answer === undefined) return cancelledResult(params.question, mode, context);
      return answeredResult(params.question, mode, [answer], context);
    }

    const answers = await askMultipleChoice(ctx, title, options, includeOther, signal);
    if (answers === undefined) return cancelledResult(params.question, mode, context);
    return answeredResult(params.question, mode, answers, context);
  }, signal);

  return result ?? cancelledResult(params.question, mode, context);
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
        return runAskUserQuestion(params, signal, ctx);
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
