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

export function eligibleOutput(event: ToolResultEvent): string | undefined {
  if (event.toolName !== "bash" || event.parentToolCallId || event.isError) return undefined;
  if (!isMatching([{ type: "text", text: P.string }], event.content)) return undefined;
  if (!isMatching({ output: P.string, truncated: false, exit_code: 0 }, event.structuredContent))
    return undefined;
  if (Object.hasOwn(event.structuredContent, "full_output_path")) return undefined;
  if (
    event.details !== undefined &&
    (!isMatching(RecordPattern, event.details) ||
      Object.hasOwn(event.details, "truncation") ||
      Object.hasOwn(event.details, "fullOutputPath"))
  )
    return undefined;
  const text = event.content[0].text;
  if (text !== event.structuredContent.output) return undefined;
  const bytes = Buffer.byteLength(text);
  if (bytes < MIN_OUTPUT_BYTES || bytes > MAX_OUTPUT_BYTES) return undefined;
  const control = [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  });
  if (control || Buffer.from(text).toString("utf8") !== text) return undefined;
  if (hasSensitiveText(text) || hasSensitiveText(String(event.input.command))) return undefined;
  return text;
}

export interface Preview {
  text: string;
  totalLines: number;
  selectedLines: number;
  ranges: { from: number; to: number }[];
}

export function makePreview(text: string, artifactPath: string): Preview | undefined {
  const lines = text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  // Whole lines keep Unicode and CRLF intact; oversized lines require the original result.
  if (lines.some((line) => Buffer.byteLength(line) > 2_000)) return undefined;
  const selected = new Set<number>();
  const add = (index: number) => {
    if (index >= 0 && index < lines.length) selected.add(index);
  };
  for (let i = 0; i < Math.min(4, lines.length); i++) add(i);
  for (let i = Math.max(0, lines.length - 6); i < lines.length; i++) add(i);
  const diagnostic =
    /\b(?:error|fail(?:ed|ure)?|warn(?:ing)?|cancel(?:led|ed)?|timeout|timed out|constraint|revision|final|result|summary|skipped|incompatible|prohibited)\b/iu;
  for (const [i, line] of lines.entries()) {
    if (diagnostic.test(line)) {
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
    `[Bash output preview: ${selected.size}/${lines.length} lines; ${Buffer.byteLength(text)} original bytes. Incomplete excerpts, not a summary.]\n`,
    `Full output: ${JSON.stringify(artifactPath)}\n`,
    "Retrieve omitted evidence with read({path: <full output path>, offset: <line>, limit: 100}); follow nextOffset until complete.\n",
  ];
  let next = 1;
  for (const range of ranges) {
    if (range.from > next) parts.push(`[Omitted lines ${next}-${range.from - 1}]\n`);
    parts.push(`[Lines ${range.from}-${range.to}]\n`);
    const excerpt = lines.slice(range.from - 1, range.to).join("");
    parts.push(excerpt);
    if (!excerpt.endsWith("\n")) parts.push("\n");
    next = range.to + 1;
  }
  if (next <= lines.length) parts.push(`[Omitted lines ${next}-${lines.length}]\n`);
  const preview = parts.join("");
  const bytes = Buffer.byteLength(preview);
  // Retain every selected diagnostic or fall back; never squeeze it out to meet the budget.
  if (bytes > MAX_PREVIEW_BYTES || bytes > Buffer.byteLength(text) * 0.75) return undefined;
  return { text: preview, ranges, totalLines: lines.length, selectedLines: selected.size };
}
