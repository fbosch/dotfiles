import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  isToolCallEventType,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { encode } from "@toon-format/toon";
import { readLockedJsonFile } from "../../lib/locked-json-file";

const MAX_CACHED_OUTPUTS = 100;
const MAX_CACHE_BYTES = 8_000_000;
const MAX_JSON_BYTES = 1_000_000;
const MIN_JSON_LENGTH = 256;
const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const TOON_OPTIONS = {
  delimiter: "\t",
  keyFolding: "safe",
} as const;
const JSON_FENCE = /```json[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g;

// Use repeated structure as a cheap gate; encoding and safety checks remain authoritative.
const MIN_CANDIDATE_ROWS = 2;
const JSON_KEY_SYNTAX_COST = 4;
const TOON_HEADER_KEY_COST = 2;
const TOON_ROW_OVERHEAD = 2;
const MIN_EXPECTED_SAVINGS = 16;
interface ConvertedOutput {
  bytes: number;
  json: string;
  toon: string;
}

function eligibleTools(raw: string | undefined): ReadonlySet<string> | undefined {
  if (raw === undefined) return undefined;

  return new Set(
    raw
      .split(",")
      .map((tool) => tool.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function userMessageConversionEnabled(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  return ["0", "false", "no", "off"].includes(raw.trim().toLowerCase()) === false;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

export type ToonPath = readonly (string | number)[];

export interface ToonCandidate {
  readonly path: ToonPath;
  readonly rows: number;
  readonly keys: readonly string[];
  readonly repeatedKeyCost: number;
  readonly estimatedToonOverhead: number;
  readonly score: number;
}

export interface ToonCandidateAnalysis {
  readonly candidates: readonly ToonCandidate[];
  readonly recommended: readonly ToonCandidate[];
}

function analyzeObjectArray(items: readonly unknown[], path: ToonPath): ToonCandidate | undefined {
  if (items.length < MIN_CANDIDATE_ROWS) return undefined;

  const first = items[0];
  if (first === undefined) return undefined;
  if (isRecord(first) === false) return undefined;

  const keys = Object.keys(first).sort();
  if (keys.length === 0) return undefined;

  for (const item of items) {
    if (isRecord(item) === false) return undefined;
    const itemKeys = Object.keys(item).sort();
    if (itemKeys.length !== keys.length) return undefined;
    for (let index = 0; index < keys.length; index += 1) {
      if (itemKeys[index] !== keys[index]) return undefined;
    }
  }

  const keyCost = keys.reduce((total, key) => total + key.length + JSON_KEY_SYNTAX_COST, 0);
  const repeatedKeyCost = (items.length - 1) * keyCost;
  const estimatedToonOverhead =
    keys.length * TOON_HEADER_KEY_COST + (items.length - 1) * TOON_ROW_OVERHEAD;

  return {
    path,
    rows: items.length,
    keys,
    repeatedKeyCost,
    estimatedToonOverhead,
    score: repeatedKeyCost - estimatedToonOverhead,
  };
}

export function findToonCandidates(value: unknown, jsonLength: number): ToonCandidateAnalysis {
  if (jsonLength < MIN_JSON_LENGTH) return { candidates: [], recommended: [] };

  const candidates: ToonCandidate[] = [];
  const pending: Array<{ value: unknown; path: ToonPath }> = [{ value, path: [] }];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;

    if (Array.isArray(current.value)) {
      const candidate = analyzeObjectArray(current.value, current.path);
      if (candidate !== undefined) candidates.push(candidate);

      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          path: current.path.concat(index),
        });
      }
      continue;
    }

    if (isRecord(current.value)) {
      const entries = Object.entries(current.value);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry === undefined) continue;
        pending.push({
          value: entry[1],
          path: current.path.concat(entry[0]),
        });
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  return {
    candidates,
    recommended: candidates.filter((candidate) => candidate.score >= MIN_EXPECTED_SAVINGS),
  };
}

export function hasRecommendedToonCandidate(value: unknown, jsonLength: number): boolean {
  if (jsonLength < MIN_JSON_LENGTH) return false;

  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      const candidate = analyzeObjectArray(current, []);
      if (candidate !== undefined && candidate.score >= MIN_EXPECTED_SAVINGS) {
        return true;
      }
      for (const item of current) {
        if (Array.isArray(item) || isRecord(item)) pending.push(item);
      }
      continue;
    }

    if (isRecord(current)) {
      for (const child of Object.values(current)) {
        if (Array.isArray(child) || isRecord(child)) pending.push(child);
      }
    }
  }

  return false;
}
interface ToonSettings {
  readonly convertToolResults: boolean;
  readonly convertUserMessages: boolean;
}

function defaultToonSettings(environmentSetting: string | undefined): ToonSettings {
  return {
    convertToolResults: true,
    convertUserMessages: userMessageConversionEnabled(environmentSetting),
  };
}

function projectToonSettings(
  cwd: string,
  trusted: boolean,
  environmentSetting: string | undefined,
): ToonSettings {
  const defaults = defaultToonSettings(environmentSetting);
  if (trusted) {
    try {
      const settings = readLockedJsonFile(join(cwd, CONFIG_DIR_NAME, "settings.json"));
      if (isRecord(settings) && isRecord(settings.toon)) {
        const convertToolResults = settings.toon.convertToolResults;
        const convertUserMessages = settings.toon.convertUserMessages;
        return {
          convertToolResults:
            typeof convertToolResults === "boolean"
              ? convertToolResults
              : defaults.convertToolResults,
          convertUserMessages:
            typeof convertUserMessages === "boolean"
              ? convertUserMessages
              : defaults.convertUserMessages,
        };
      }
    } catch {
      // Fall back to environment and built-in defaults when project settings cannot be read.
    }
  }
  return defaults;
}

function looksLikeJson(text: string): boolean {
  const first = text.charCodeAt(0);
  const last = text.charCodeAt(text.length - 1);
  return (first === 123 && last === 125) || (first === 91 && last === 93);
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function shellSingleQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function containsLossyNumber(text: string): boolean {
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character !== "-" && (character === undefined || character < "0" || character > "9")) {
      continue;
    }

    const token = text.slice(index).match(JSON_NUMBER)?.[0];
    if (token === undefined) continue;
    const value = Number(token);
    if (
      Number.isFinite(value) === false ||
      JSON.stringify(value) !== token ||
      (Number.isInteger(value) && Number.isSafeInteger(value) === false)
    ) {
      return true;
    }
    index += token.length - 1;
  }

  return false;
}

function isShellWordBoundary(character: string | undefined): boolean {
  return character === undefined || /[\s|&;()<>]/.test(character);
}

export function createToonTransformer(
  rawEligibleTools: string | undefined = process.env.PI_TOON_EXTENSION_TOOLS,
) {
  const tools = eligibleTools(rawEligibleTools);
  const convertedOutputs = new Map<string, ConvertedOutput>();
  let cachedBytes = 0;

  function cacheConvertedOutput(toon: string, json: string): boolean {
    const hash = hashText(toon);
    const existing = convertedOutputs.get(hash);
    if (existing !== undefined && (existing.toon !== toon || existing.json !== json)) return false;

    if (existing !== undefined) cachedBytes -= existing.bytes;
    convertedOutputs.delete(hash);
    const bytes = Buffer.byteLength(json) + Buffer.byteLength(toon);
    convertedOutputs.set(hash, { bytes, json, toon });
    cachedBytes += bytes;

    while (convertedOutputs.size > MAX_CACHED_OUTPUTS || cachedBytes > MAX_CACHE_BYTES) {
      const oldest = convertedOutputs.keys().next().value;
      if (oldest === undefined) return false;
      cachedBytes -= convertedOutputs.get(oldest)?.bytes ?? 0;
      convertedOutputs.delete(oldest);
    }
    return true;
  }

  function cachedJson(text: string): string | undefined {
    const converted = convertedOutputs.get(hashText(text));
    return converted?.toon === text ? converted.json : undefined;
  }

  function replaceQuotedPayloads(command: string): string {
    // Without a full shell parser, nested double-quoted or backtick syntax cannot be rewritten safely.
    if (command.includes('"') || command.includes("`")) return command;

    let cursor = 0;
    let index = 0;
    let replaced = "";

    while (index < command.length) {
      const character = command[index];
      if (character === "\\") {
        index += 2;
        continue;
      }

      if (character === "#" && isShellWordBoundary(command[index - 1])) {
        const newline = command.indexOf("\n", index + 1);
        index = newline === -1 ? command.length : newline + 1;
        continue;
      }

      if (character === '"' || character === "`") {
        const delimiter = character;
        index += 1;
        while (index < command.length) {
          if (command[index] === "\\") {
            index += 2;
            continue;
          }
          if (command[index] === delimiter) {
            index += 1;
            break;
          }
          index += 1;
        }
        continue;
      }

      if (character !== "'") {
        index += 1;
        continue;
      }

      const closingQuote = command.indexOf("'", index + 1);
      if (closingQuote === -1) break;
      const startsWord = isShellWordBoundary(command[index - 1]);
      const endsWord = isShellWordBoundary(command[closingQuote + 1]);
      if (startsWord && endsWord) {
        const json = cachedJson(command.slice(index + 1, closingQuote));
        if (json !== undefined) {
          replaced += command.slice(cursor, index) + shellSingleQuote(json);
          cursor = closingQuote + 1;
        }
      }
      index = closingQuote + 1;
    }

    return replaced + command.slice(cursor);
  }

  function transformJson(text: string): string | undefined {
    const json = text.trim();
    if (json.length < MIN_JSON_LENGTH || looksLikeJson(json) === false) return undefined;
    if (Buffer.byteLength(json) > MAX_JSON_BYTES) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return undefined;
    }
    if (hasRecommendedToonCandidate(parsed, json.length) === false) return undefined;
    if (containsLossyNumber(json)) return undefined;

    try {
      const toon = encode(parsed, TOON_OPTIONS);
      if (toon.length >= json.length) return undefined;
      if (cacheConvertedOutput(toon, json) === false) return undefined;
      return toon;
    } catch {
      return undefined;
    }
  }

  function transformText(text: string): string | undefined {
    const direct = transformJson(text);
    if (direct !== undefined) return direct;

    let changed = false;
    const transformed = text.replace(JSON_FENCE, (block, body: string) => {
      const toon = transformJson(body);
      if (toon === undefined) return block;

      const firstNewline = block.indexOf("\n");
      const closingNewline = block.lastIndexOf("\n");
      const toonBlock = `${block.slice(0, firstNewline + 1).replace(/^```json/, "```toon")}${toon}${block.slice(closingNewline)}`;
      if (cacheConvertedOutput(toonBlock, block) === false) return block;

      changed = true;
      return toonBlock;
    });

    return changed ? transformed : undefined;
  }

  return {
    clear(): void {
      convertedOutputs.clear();
      cachedBytes = 0;
    },
    restoreCommand(command: string): string {
      return replaceQuotedPayloads(command);
    },
    transformText,
    transformResult(
      event: Pick<ToolResultEvent, "content" | "isError" | "toolName">,
    ): ToolResultEvent["content"] | undefined {
      if (
        event.isError ||
        (tools !== undefined && tools.has(event.toolName.toLowerCase()) === false)
      )
        return undefined;
      if (event.content.length !== 1) return undefined;

      const content = event.content[0];
      if (content?.type !== "text") return undefined;

      const text = transformText(content.text);
      return text === undefined ? undefined : [{ ...content, text }];
    },
  };
}

export default function toonExtension(pi: ExtensionAPI): void {
  const transformer = createToonTransformer();
  let toonSettings = defaultToonSettings(process.env.PI_TOON_EXTENSION_USER_MESSAGES);
  pi.on("session_start", (_event, ctx) => {
    toonSettings = projectToonSettings(
      ctx.cwd,
      ctx.isProjectTrusted(),
      process.env.PI_TOON_EXTENSION_USER_MESSAGES,
    );
  });

  pi.on("tool_call", (event) => {
    if (isToolCallEventType("bash", event) === false) return;

    const command = transformer.restoreCommand(event.input.command);
    if (command !== event.input.command) event.input.command = command;
  });

  pi.on("tool_result", (event) => {
    if (toonSettings.convertToolResults === false) return;
    const content = transformer.transformResult(event);
    return content === undefined ? undefined : { content };
  });

  pi.on("context", (event) => {
    if (toonSettings.convertUserMessages === false) return;
    let changed = false;
    const messages = event.messages.map((message) => {
      if (message.role !== "user") return message;

      if (typeof message.content === "string") {
        const text = transformer.transformText(message.content);
        if (text === undefined) return message;
        changed = true;
        return { ...message, content: text };
      }

      let messageChanged = false;
      const content = message.content.map((part) => {
        if (part.type !== "text") return part;
        const text = transformer.transformText(part.text);
        if (text === undefined) return part;
        messageChanged = true;
        return { ...part, text };
      });
      if (messageChanged === false) return message;

      changed = true;
      return { ...message, content };
    });

    return changed ? { messages } : undefined;
  });

  pi.on("session_shutdown", () => {
    transformer.clear();
  });
}
