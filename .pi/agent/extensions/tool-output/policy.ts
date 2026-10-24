import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { isMatching, P } from "ts-pattern";

export const MIN_OUTPUT_BYTES = 8_000;
export const MAX_OUTPUT_BYTES = 128_000;
export const MAX_PREVIEW_BYTES = 6_000;
export const MAX_SESSION_BYTES = 8 * 1024 * 1024;
const RecordPattern = P.record(P.string, P.unknown);
const SettingsPattern = { enabled: P.boolean };

function enabledSetting(settings: unknown): boolean | undefined {
  if (settings === undefined) return undefined;
  if (!isMatching(RecordPattern, settings)) throw new Error("Invalid settings");
  const value = settings.toolOutput;
  if (value === undefined) return undefined;
  if (!isMatching(SettingsPattern, value) || Object.keys(value).some((key) => key !== "enabled"))
    throw new Error("Invalid toolOutput settings");
  return value.enabled;
}

export function outputEnabled(global: unknown, project: unknown, trusted: boolean): boolean {
  if (!trusted) return false;
  const allowed = enabledSetting(global);
  return allowed !== false && enabledSetting(project) === true;
}

// A rejection heuristic, not a guarantee that arbitrary output contains no sensitive data.
export function hasSensitiveText(text: string): boolean {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:bearer|basic)\s+[\w+/=-]+|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization|cookie)\b["']?\s*[:=]|\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{12,}|github_pat_[\w]+|AKIA[A-Z0-9]{16})\b|\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/[^\s/]+:[^\s/]+@/iu.test(
    text,
  );
}

export interface OutputCapture {
  text: string;
  source: "bash" | "mcp";
  coverage: "complete-model-facing-text" | "received-single-text-block";
  isError: boolean;
  exitCode?: number;
}

export function eligibleCapture(event: ToolResultEvent): OutputCapture | undefined {
  if (event.parentToolCallId || !isMatching([{ type: "text", text: P.string }], event.content))
    return undefined;
  if (
    event.details !== undefined &&
    (!isMatching(RecordPattern, event.details) ||
      Object.hasOwn(event.details, "truncation") ||
      Object.hasOwn(event.details, "fullOutputPath"))
  )
    return undefined;
  const text = event.content[0].text;
  let capture: OutputCapture;
  if (event.toolName === "bash") {
    if (
      !isMatching(
        { output: P.string, truncated: false, exit_code: P.number.int() },
        event.structuredContent,
      )
    )
      return undefined;
    const native = event.structuredContent;
    if (
      !Number.isSafeInteger(native.exit_code) ||
      Object.hasOwn(native, "full_output_path") ||
      event.isError !== (native.exit_code !== 0)
    )
      return undefined;
    const expected =
      native.exit_code === 0
        ? native.output
        : `${native.output ? `${native.output}\n\n` : ""}Command exited with code ${native.exit_code}`;
    // Do not undo a previous result hook's redaction or reintroduce structured-only text.
    if (text !== expected) return undefined;
    capture = {
      text,
      source: "bash",
      coverage: "complete-model-facing-text",
      isError: event.isError,
      exitCode: native.exit_code,
    };
  } else if (event.toolName.startsWith("mcp__")) {
    if (
      !isMatching({ server: P.string, tool: P.string }, event.details) ||
      !isMatching(
        { content: [{ type: "text", text: P.string }], isError: P.optional(P.boolean) },
        event.structuredContent,
      )
    )
      return undefined;
    if (
      text !== event.structuredContent.content[0].text ||
      event.isError !== (event.structuredContent.isError === true)
    )
      return undefined;
    capture = {
      text,
      source: "mcp",
      coverage: "received-single-text-block",
      isError: event.isError,
    };
  } else return undefined;
  const bytes = Buffer.byteLength(text);
  if (bytes < MIN_OUTPUT_BYTES || bytes > MAX_OUTPUT_BYTES) return undefined;
  const control = [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });
  if (control || Buffer.from(text).toString("utf8") !== text) return undefined;
  if (hasSensitiveText(text) || hasSensitiveText(JSON.stringify(event.input))) return undefined;
  return capture;
}

export interface Preview {
  text: string;
  totalLines: number;
  selectedLines: number;
  ranges: { from: number; to: number }[];
}

const DIAGNOSTIC =
  /\b(?:error|fail(?:ed|ure)?|warn(?:ing)?|cancel(?:led|ed)?|timeout|timed out|constraint|revision|final|result|summary|skipped|incompatible|prohibited)\b/iu;

interface ProgressFamily {
  indices: number[];
  previous: number[];
  ordered: boolean;
}

function repeatedProgress(lines: string[]): Set<number> {
  const families = new Map<string, ProgressFamily>();
  for (const [index, line] of lines.entries()) {
    if (DIAGNOSTIC.test(line)) continue;
    // Only explicit progress prefixes qualify. Keep payloads, measurements, paths, and IDs exact.
    const parts = /^([ \t]*(?:progress|scan(?:ning)?)\b[^:\r\n]*):([^\r\n]*)(\r?\n)?$/iu.exec(line);
    if (!parts) continue;
    const prefix = parts[1];
    if (prefix === undefined || !/^[a-z\d \t,/%.-]+$/iu.test(prefix)) continue;
    const labels = prefix.match(/[a-z]+/giu) ?? [];
    if (
      labels.some(
        (label) =>
          !/^(?:progress|scan|scanning|block|tick|item|batch|step|of|total)$/iu.test(label),
      )
    )
      continue;
    const counters = [...prefix.matchAll(/\b\d+\b/gu)].map((match) => Number(match[0]));
    if (counters.some((counter) => !Number.isSafeInteger(counter))) continue;
    const key = JSON.stringify([
      prefix.replace(/\b\d+\b/gu, "#"),
      parts[2]?.replace(/[ \t]+$/u, ""),
      parts[3],
    ]);
    const family = families.get(key);
    if (!family) {
      families.set(key, { indices: [index], previous: counters, ordered: true });
      continue;
    }
    const changed = counters.findIndex((value, i) => value !== family.previous[i]);
    if (
      counters.length !== family.previous.length ||
      (counters.length > 0 &&
        (changed < 0 || (counters[changed] ?? 0) <= (family.previous[changed] ?? 0)))
    )
      family.ordered = false;
    family.previous = counters;
    family.indices.push(index);
  }
  const collapsible = new Set<number>();
  for (const family of families.values()) {
    // Rare progress lines and reset/out-of-order counters may carry different meaning.
    if (!family.ordered || family.indices.length < 8) continue;
    for (const index of family.indices.slice(1, -1)) collapsible.add(index);
  }
  return collapsible;
}

export function makePreview(
  text: string,
  artifactPath: string,
  searchAvailable = false,
  status: Pick<OutputCapture, "source" | "isError" | "exitCode"> = {
    source: "bash",
    isError: false,
  },
): Preview | undefined {
  const lines = text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  // Whole lines keep Unicode and CRLF intact; oversized lines require the original result.
  if (lines.some((line) => Buffer.byteLength(line) > 2_000)) return undefined;
  const selected = new Set<number>();
  const add = (index: number) => {
    if (index >= 0 && index < lines.length) selected.add(index);
  };
  for (let i = 0; i < Math.min(4, lines.length); i++) add(i);
  for (let i = Math.max(0, lines.length - 6); i < lines.length; i++) add(i);
  const collapsible = repeatedProgress(lines);
  for (const [i] of lines.entries()) {
    if (!collapsible.has(i)) {
      add(i - 1);
      add(i);
      add(i + 1);
    }
  }
  const ranges: Preview["ranges"] = [];
  for (const i of [...selected].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && last.to === i) last.to = i + 1;
    else ranges.push({ from: i + 1, to: i + 1 });
  }
  const parts = [
    `[${status.source === "bash" ? "Bash" : "MCP"} output; isError=${status.isError}${status.exitCode === undefined ? "" : `; exitCode=${status.exitCode}`}: ${selected.size}/${lines.length} lines; ${Buffer.byteLength(text)} original bytes. Only repeated progress templates collapsed; all other lines are shown.]\n`,
    `Full output: ${JSON.stringify(artifactPath)}\n`,
    ...(searchAvailable
      ? [
          "Search exact progress counters with tool_output_search({path: <full output path>, queries: [<literal substring>]}). Counts cover the entire captured artifact.\n",
        ]
      : []),
    "For exact progress counters, use read({path: <full output path>, offset: <line>, limit: 100}). Collapsed line ranges are listed below.\n",
  ];
  let next = 1;
  for (const range of ranges) {
    if (range.from > next)
      parts.push(`[Collapsed repeated progress lines ${next}-${range.from - 1}]\n`);
    parts.push(`[Lines ${range.from}-${range.to}]\n`);
    const excerpt = lines.slice(range.from - 1, range.to).join("");
    parts.push(excerpt);
    if (!excerpt.endsWith("\n")) parts.push("\n");
    next = range.to + 1;
  }
  if (next <= lines.length)
    parts.push(`[Collapsed repeated progress lines ${next}-${lines.length}]\n`);
  const preview = parts.join("");
  const bytes = Buffer.byteLength(preview);
  // Never discard non-progress evidence just to meet the budget.
  if (bytes > MAX_PREVIEW_BYTES || bytes > Buffer.byteLength(text) * 0.75) return undefined;
  return { text: preview, ranges, totalLines: lines.length, selectedLines: selected.size };
}
