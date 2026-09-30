import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  convertToLlm,
  getAgentDir,
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Api, Message, Model } from "@earendil-works/pi-ai";
import { Key, Markdown, matchesKey, type Component, type TUI } from "@earendil-works/pi-tui";

const WIDGET_KEY = "btw";
const MAX_QUESTION_BYTES = 2_000;
const MAX_CONTEXT_BYTES = 128_000;
const MAX_CONTEXT_MESSAGES = 256;
const MAX_ANSWER_BYTES = 32_000;
const REQUEST_DEADLINE_MS = 60_000;
const MAX_MODEL_CHOICES = 300;
const REASONING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
const TOKEN_CHOICES = [250, 500, 1_000, 2_000, 4_000] as const;
const SETTINGS_PATH = join(getAgentDir(), "btw-settings.json");

type Reasoning = (typeof REASONING_LEVELS)[number];

export interface BtwSettings {
  modelStrategy: "same-as-main" | "custom";
  customProvider?: string;
  customModelId?: string;
  reasoning: Reasoning;
  maxTokens: (typeof TOKEN_CHOICES)[number];
  cacheRetention: "short";
}

interface Snapshot {
  readonly sessionId: string;
  readonly modelKey: string;
  readonly mainProvider: string;
  readonly messages: readonly Message[];
  readonly generation: number;
}

interface ActiveRequest {
  readonly generation: number;
  readonly controller: AbortController;
  readonly question: string;
  readonly model: Model<Api>;
  readonly snapshot: Snapshot;
  readonly settings: BtwSettings;
  closed: boolean;
  timedOut: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  unsubscribe: (() => void) | undefined;
  widget: BtwWidget | undefined;
  close: () => void;
}

const DEFAULT_SETTINGS: BtwSettings = {
  modelStrategy: "same-as-main",
  reasoning: "off",
  maxTokens: 500,
  cacheRetention: "short",
};

const SIDE_ANSWER_INSTRUCTION =
  "Answer only this ephemeral side question, briefly, using the captured conversation context. You have no tools; do not request, simulate, or output tool calls. If context is insufficient, say so briefly. Do not continue the main task.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReasoning(value: unknown): value is Reasoning {
  return typeof value === "string" && (REASONING_LEVELS as readonly string[]).includes(value);
}

function isTokenChoice(value: unknown): value is BtwSettings["maxTokens"] {
  return typeof value === "number" && (TOKEN_CHOICES as readonly number[]).includes(value);
}

export function parseSettings(value: unknown): BtwSettings {
  if (!isRecord(value)) throw new Error("Invalid /btw settings");
  if (value.modelStrategy !== "same-as-main" && value.modelStrategy !== "custom") {
    throw new Error("Invalid /btw settings");
  }
  if (!isReasoning(value.reasoning) || !isTokenChoice(value.maxTokens) || value.cacheRetention !== "short") {
    throw new Error("Invalid /btw settings");
  }
  if (value.modelStrategy === "custom") {
    if (
      typeof value.customProvider !== "string" ||
      value.customProvider.length === 0 ||
      value.customProvider.length > 128 ||
      typeof value.customModelId !== "string" ||
      value.customModelId.length === 0 ||
      value.customModelId.length > 256
    ) {
      throw new Error("Invalid /btw settings");
    }
    return {
      modelStrategy: "custom",
      customProvider: value.customProvider,
      customModelId: value.customModelId,
      reasoning: value.reasoning,
      maxTokens: value.maxTokens,
      cacheRetention: "short",
    };
  }
  if (value.customProvider !== undefined || value.customModelId !== undefined) {
    throw new Error("Invalid /btw settings");
  }
  return { ...DEFAULT_SETTINGS, reasoning: value.reasoning, maxTokens: value.maxTokens };
}

function loadSettings(): { settings: BtwSettings; invalid: boolean } {
  try {
    const text = readFileSync(SETTINGS_PATH, "utf8");
    return { settings: parseSettings(JSON.parse(text)), invalid: false };
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return { settings: { ...DEFAULT_SETTINGS }, invalid: false };
    return { settings: { ...DEFAULT_SETTINGS }, invalid: true };
  }
}

function saveSettings(settings: BtwSettings): void {
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function modelKey(model: Model<Api> | undefined): string | undefined {
  return model ? `${model.provider}/${model.id}` : undefined;
}

function sessionId(ctx: ExtensionContext): string | undefined {
  const id = ctx.sessionManager.getHeader()?.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function safeText(value: string): string {
  return stripTerminalControls(value);
}

/** Re-sanitizing the complete buffer keeps controls split across stream chunks inert. */
export function stripTerminalControls(input: string): string {
  let output = "";
  let state: "text" | "escape" | "csi" | "string" | "string-escape" = "text";
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    const character = input[index] ?? "";
    if (state === "text") {
      if (code === 0x1b) state = "escape";
      else if (code === 0x9b) state = "csi";
      else if (code === 0x9d || code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) state = "string";
      else if (
        code === 0x9c ||
        (code < 0x20 && code !== 0x09 && code !== 0x0a) ||
        (code >= 0x80 && code <= 0x9f) ||
        code === 0x7f
      ) continue;
      else output += character;
      continue;
    }
    if (state === "escape") {
      if (character === "[") state = "csi";
      else if (character === "]" || character === "P" || character === "X" || character === "^" || character === "_") state = "string";
      else state = "text";
      continue;
    }
    if (state === "csi") {
      if (code >= 0x40 && code <= 0x7e) state = "text";
      continue;
    }
    if (state === "string") {
      if (code === 0x07 || code === 0x9c) state = "text";
      else if (code === 0x1b) state = "string-escape";
      continue;
    }
    if (character === "\\" || code === 0x9c) state = "text";
    else if (code !== 0x1b) state = "string";
  }
  return output;
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

function cloneOutboundMessages(source: readonly Parameters<typeof convertToLlm>[0][number][]): Message[] | undefined {
  if (source.length > MAX_CONTEXT_MESSAGES) return undefined;
  try {
    const converted = convertToLlm([...source]);
    if (converted.length > MAX_CONTEXT_MESSAGES) return undefined;
    const serialized = JSON.stringify(converted);
    if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > MAX_CONTEXT_BYTES) return undefined;
    const messages = structuredClone(converted);
    for (const message of messages) {
      if (message.role === "system") {
        delete message.toolsAdded;
        delete message.toolsRemoved;
      }
    }
    deepFreeze(messages);
    return messages;
  } catch {
    return undefined;
  }
}

function getSelectedModel(
  ctx: ExtensionContext,
  settings: BtwSettings,
): Model<Api> | undefined {
  if (settings.modelStrategy === "same-as-main") return ctx.model;
  const provider = settings.customProvider;
  const modelId = settings.customModelId;
  if (provider === undefined || modelId === undefined) return undefined;
  return ctx.modelRegistry.find(provider, modelId);
}

function sanitizeModelLabel(model: Model<Api>): string {
  return safeText(`${model.provider}/${model.id}`).slice(0, 180);
}

function errorText(category: "timeout" | "tools" | "oversize" | "provider"): string {
  switch (category) {
    case "timeout":
      return "The /btw request timed out. Dismiss this answer and try again.";
    case "tools":
      return "This side answer cannot use tools. Ask a question answerable from the captured context.";
    case "oversize":
      return "The /btw response exceeded its output limit.";
    case "provider":
      return "The /btw provider request failed. Check provider configuration and try again.";
  }
}

class BtwWidget implements Component {
  private readonly markdown: Markdown;
  private answer = "";
  private status = "Waiting for confirmation…";
  private error: string | undefined;
  private disposed = false;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly question: string,
    private readonly modelLabel: string,
    onDispose: () => void,
  ) {
    this.markdown = new Markdown("", 2, 0, getMarkdownTheme());
    this.onDispose = onDispose;
  }

  private readonly onDispose: () => void;

  setStatus(status: string): void {
    if (this.disposed) return;
    this.status = safeText(status);
    this.tui.requestRender();
  }

  setAnswer(answer: string): void {
    if (this.disposed) return;
    this.answer = safeText(answer);
    this.markdown.setText(this.answer);
    this.tui.requestRender();
  }

  setError(message: string): void {
    if (this.disposed) return;
    this.error = safeText(message);
    this.status = "";
    this.tui.requestRender();
  }

  invalidate(): void {
    this.markdown.invalidate();
  }

  render(width: number): string[] {
    if (this.disposed) return [];
    const safeWidth = Math.max(1, width);
    const lines = [
      this.theme.fg("accent", "/btw"),
      this.theme.fg("dim", this.question),
      "",
      this.error
        ? this.theme.fg("error", this.error)
        : this.theme.fg("warning", `${this.status}${this.status ? ` · ${this.modelLabel}` : ""}`),
      ...(this.answer ? this.markdown.render(safeWidth) : []),
      "",
      this.theme.fg("dim", "Press Space, Enter, or Escape to dismiss"),
    ];
    return lines.map((line) => line);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onDispose();
  }
}

function mountRequestWidget(ctx: ExtensionContext, owner: ActiveRequest): void {
  ctx.ui.setWidget(
    WIDGET_KEY,
    (_tui, theme) => {
      const widget = new BtwWidget(_tui, theme, owner.question, sanitizeModelLabel(owner.model), owner.close);
      owner.widget = widget;
      return widget;
    },
    { placement: "aboveEditor" },
  );
  owner.unsubscribe = ctx.ui.onTerminalInput((data) => {
    if (owner.closed || activeRequest !== owner) return undefined;
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      owner.close();
      return { consume: true };
    }
    return undefined;
  });
}

let currentSettings = { ...DEFAULT_SETTINGS };
let settingsInvalid = false;
let latestSnapshot: Snapshot | undefined;
let generation = 0;
let activeRequest: ActiveRequest | undefined;

function clearStatus(ctx: ExtensionContext): void {
  if (ctx.mode === "tui") ctx.ui.setStatus("btw", undefined);
}

function invalidate(ctx: ExtensionContext): void {
  generation += 1;
  latestSnapshot = undefined;
  const current = activeRequest;
  if (current) {
    current.close();
    clearStatus(ctx);
  }
}

function isCurrent(owner: ActiveRequest): boolean {
  return !owner.closed && activeRequest === owner && owner.generation === generation && !owner.controller.signal.aborted;
}

function makeOwner(
  ctx: ExtensionContext,
  question: string,
  model: Model<Api>,
  snapshot: Snapshot,
  settings: BtwSettings,
): ActiveRequest {
  const owner: ActiveRequest = {
    generation,
    controller: new AbortController(),
    question,
    model,
    snapshot,
    settings: { ...settings },
    closed: false,
    timedOut: false,
    timer: undefined,
    unsubscribe: undefined,
    widget: undefined,
    close: () => undefined,
  };
  owner.close = () => {
    if (owner.closed) return;
    owner.closed = true;
    owner.controller.abort();
    if (owner.timer !== undefined) clearTimeout(owner.timer);
    owner.timer = undefined;
    owner.unsubscribe?.();
    owner.unsubscribe = undefined;
    clearStatus(ctx);
    if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
    if (activeRequest === owner) activeRequest = undefined;
  };
  owner.timer = setTimeout(() => {
    if (!isCurrent(owner)) return;
    owner.timedOut = true;
    owner.controller.abort();
    owner.widget?.setError(errorText("timeout"));
  }, REQUEST_DEADLINE_MS);
  return owner;
}

async function startQuestion(ctx: ExtensionContext, rawQuestion: string): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/btw is available only in interactive TUI mode.", "warning");
    return;
  }
  if (activeRequest) {
    ctx.ui.notify("A /btw answer is already active. Dismiss it first.", "info");
    return;
  }
  if (settingsInvalid) {
    ctx.ui.notify("Invalid /btw-settings.json. Run /btw-settings to replace it.", "error");
    return;
  }
  const question = safeText(rawQuestion.trim());
  if (question.length === 0) {
    ctx.ui.notify("Usage: /btw <question>", "warning");
    return;
  }
  if (Buffer.byteLength(question, "utf8") > MAX_QUESTION_BYTES) {
    ctx.ui.notify("The /btw question exceeds the 2 KB limit.", "warning");
    return;
  }
  const snapshot = latestSnapshot;
  const currentSessionId = sessionId(ctx);
  const currentModelKey = modelKey(ctx.model);
  if (
    snapshot === undefined ||
    currentSessionId === undefined ||
    snapshot.sessionId !== currentSessionId ||
    snapshot.modelKey !== currentModelKey ||
    snapshot.generation !== generation
  ) {
    ctx.ui.notify("No current outbound context snapshot is available. Wait for a main response, then try /btw.", "warning");
    return;
  }
  const settings = { ...currentSettings };
  const model = getSelectedModel(ctx, settings);
  if (model === undefined) {
    ctx.ui.notify(
      settings.modelStrategy === "custom"
        ? "The configured /btw model is unavailable. Choose an available model in /btw-settings."
        : "No main model is selected.",
      "error",
    );
    return;
  }
  if (activeRequest) return;
  const owner = makeOwner(ctx, question, model, snapshot, settings);
  activeRequest = owner;
  mountRequestWidget(ctx, owner);
  ctx.ui.setStatus("btw", "π btw");
  void runQuestion(ctx, owner);
}

async function runQuestion(ctx: ExtensionContext, owner: ActiveRequest): Promise<void> {
  if (!isCurrent(owner)) return;
  const modelLabel = sanitizeModelLabel(owner.model);
  if (owner.model.provider !== owner.snapshot.mainProvider) {
    let accepted = false;
    try {
      accepted = await ctx.ui.confirm(
        "Send captured context to another provider?",
        `Continuing sends the captured outbound conversation to ${modelLabel}, including the system prompt, prior tool outputs, and other context. The snapshot is captured after context handlers, but cannot guarantee redactions applied later during provider payload assembly. This extension does not save the snapshot. Continue?`,
      );
    } catch {
      if (isCurrent(owner)) owner.widget?.setError("The provider consent prompt could not be displayed.");
      return;
    }
    if (!isCurrent(owner)) return;
    if (!accepted) {
      owner.widget?.setError("No request was sent. Cross-provider consent was declined.");
      if (owner.timer !== undefined) clearTimeout(owner.timer);
      owner.timer = undefined;
      return;
    }
  }
  if (!isCurrent(owner)) return;
  owner.widget?.setStatus("Answering");
  let rawAnswer = "";
  try {
    const messages: Message[] = [
      ...owner.snapshot.messages,
      {
        role: "user",
        content: `${SIDE_ANSWER_INSTRUCTION}\n\nQuestion: ${owner.question}`,
        timestamp: Date.now(),
      },
    ];
    const stream = ctx.modelRegistry.streamSimple(
      owner.model,
      { messages },
      {
        maxTokens: owner.settings.maxTokens,
        cacheRetention: owner.settings.cacheRetention,
        signal: owner.controller.signal,
        ...(owner.settings.reasoning !== "off" && owner.model.reasoning
          ? { reasoning: owner.settings.reasoning }
          : {}),
      },
    );
    for await (const event of stream) {
      if (!isCurrent(owner)) return;
      if (event.type === "text_delta") {
        if (Buffer.byteLength(rawAnswer, "utf8") + Buffer.byteLength(event.delta, "utf8") > MAX_ANSWER_BYTES) {
          owner.widget?.setError(errorText("oversize"));
          owner.controller.abort();
          return;
        }
        rawAnswer += event.delta;
        owner.widget?.setAnswer(rawAnswer);
      } else if (
        event.type === "toolcall_start" ||
        event.type === "toolcall_delta" ||
        event.type === "toolcall_end"
      ) {
        owner.widget?.setError(errorText("tools"));
        owner.controller.abort();
        return;
      } else if (event.type === "error") {
        owner.widget?.setError(errorText("provider"));
        return;
      } else if (event.type === "done") {
        owner.widget?.setStatus("Done");
        return;
      }
    }
    if (isCurrent(owner)) owner.widget?.setStatus("Done");
  } catch {
    if (isCurrent(owner)) {
      owner.widget?.setError(owner.timedOut ? errorText("timeout") : errorText("provider"));
    }
  }
}

function updateSnapshot(event: { messages: Parameters<typeof convertToLlm>[0] }, ctx: ExtensionContext): void {
  const id = sessionId(ctx);
  const key = modelKey(ctx.model);
  if (id === undefined || key === undefined || ctx.model === undefined) {
    latestSnapshot = undefined;
    return;
  }
  const messages = cloneOutboundMessages(event.messages);
  if (messages === undefined) {
    latestSnapshot = undefined;
    ctx.ui.notify("/btw context snapshot exceeds its size limit and was discarded.", "warning");
    return;
  }
  latestSnapshot = Object.freeze({
    sessionId: id,
    modelKey: key,
    mainProvider: ctx.model.provider,
    messages,
    generation,
  });
}

async function configureSettings(ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/btw-settings is available only in interactive TUI mode.", "warning");
    return;
  }
  const available = ctx.modelRegistry.getAvailable().slice(0, MAX_MODEL_CHOICES);
  const byLabel = new Map<string, Model<Api>>();
  const modelOptions = ["Same as main session"];
  for (const model of available) {
    const label = safeText(`${model.provider}/${model.id}`).slice(0, 180);
    if (label.length === 0 || byLabel.has(label)) continue;
    byLabel.set(label, model);
    modelOptions.push(label);
  }
  let next: BtwSettings = { ...currentSettings };
  const selectedModel = await ctx.ui.select("/btw model", modelOptions);
  if (selectedModel === undefined) return;
  if (selectedModel === "Same as main session") {
    const { customProvider: _provider, customModelId: _modelId, ...sameModelSettings } = next;
    next = { ...sameModelSettings, modelStrategy: "same-as-main" };
  } else {
    const selected = byLabel.get(selectedModel);
    if (selected === undefined) return;
    next = {
      ...next,
      modelStrategy: "custom",
      customProvider: selected.provider,
      customModelId: selected.id,
    };
  }
  const selectedModelInfo = getSelectedModel(ctx, next);
  const reasoningOptions = selectedModelInfo?.reasoning ? [...REASONING_LEVELS] : ["off"];
  const selectedReasoning = await ctx.ui.select("/btw reasoning", reasoningOptions);
  if (selectedReasoning === undefined || !isReasoning(selectedReasoning)) return;
  const selectedTokens = await ctx.ui.select("/btw maximum output tokens", TOKEN_CHOICES.map(String));
  if (selectedTokens === undefined) return;
  const parsedTokens = Number(selectedTokens);
  if (!isTokenChoice(parsedTokens)) return;
  next = {
    ...next,
    reasoning: selectedModelInfo?.reasoning ? selectedReasoning : "off",
    maxTokens: parsedTokens,
    cacheRetention: "short",
  };
  try {
    saveSettings(next);
  } catch {
    ctx.ui.notify("Could not save /btw-settings.json. Settings were not changed.", "error");
    return;
  }
  currentSettings = next;
  settingsInvalid = false;
  ctx.ui.notify("/btw settings saved.", "info");
}

export default function btwExtension(pi: ExtensionAPI): void {
  const loaded = loadSettings();
  currentSettings = loaded.settings;
  settingsInvalid = loaded.invalid;

  pi.on("context_with_system", (event, ctx) => updateSnapshot(event, ctx));
  pi.on("agent_start", (_event, ctx) => invalidate(ctx));
  pi.on("model_select", (_event, ctx) => invalidate(ctx));
  pi.on("session_start", (_event, ctx) => {
    invalidate(ctx);
    const persisted = loadSettings();
    currentSettings = persisted.settings;
    settingsInvalid = persisted.invalid;
    if (settingsInvalid) ctx.ui.notify("Invalid /btw-settings.json. Run /btw-settings to replace it.", "error");
  });
  pi.on("session_before_switch", (_event, ctx) => invalidate(ctx));
  pi.on("session_before_fork", (_event, ctx) => invalidate(ctx));
  pi.on("session_before_tree", (_event, ctx) => invalidate(ctx));
  pi.on("session_tree", (_event, ctx) => invalidate(ctx));
  pi.on("session_before_compact", (_event, ctx) => invalidate(ctx));
  pi.on("session_compact", (_event, ctx) => invalidate(ctx));
  pi.on("session_shutdown", (_event, ctx) => invalidate(ctx));

  pi.registerCommand("btw", {
    description: "Ask an ephemeral side question about the latest observed outbound context (no tools)",
    handler: async (args, ctx) => startQuestion(ctx, args),
  });
  pi.registerCommand("btw-settings", {
    description: "Configure /btw model, reasoning, and output-token limit",
    handler: async (_args, ctx) => configureSettings(ctx),
  });
}
