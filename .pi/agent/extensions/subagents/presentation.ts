import { stripVTControlCharacters } from "node:util";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { match } from "ts-pattern";
import type { ChildObservation } from "./driver";
import type { WorkerSnapshot, WorkerStatusSnapshot } from "./owner";

/** Tool output is untrusted terminal content, including when restored from history. */
export function terminalText(text: string): string {
  const escapeCharacter = String.fromCharCode(27);
  const bell = String.fromCharCode(7);
  let plain = "";
  // Strip OSC before the host utility so terminal-command payloads cannot enter display text.
  for (let index = 0; index < text.length; index++) {
    if (text[index] === escapeCharacter && text[index + 1] === "]") {
      index += 2;
      while (
        index < text.length &&
        text[index] !== bell &&
        !(text[index] === escapeCharacter && text[index + 1] === "\\")
      )
        index++;
      if (text[index] === escapeCharacter) index++;
    } else plain += text[index];
  }
  return Array.from(stripVTControlCharacters(plain))
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return code === 9 || code === 10 || (code >= 32 && (code < 127 || code > 159));
    })
    .join("");
}
export type DisplayTheme = Pick<import("@earendil-works/pi-coding-agent").Theme, "fg" | "bold">;
export const plainTheme: DisplayTheme = { fg: (_color, text) => text, bold: (text) => text };
export function statusGlyph(
  state: string,
  theme: DisplayTheme = plainTheme,
  activityFrame = 0,
): string {
  return match(state)
    .with("completed", () => theme.fg("success", "✓"))
    .with("failed", "cleanup-unknown", () => theme.fg("error", "✗"))
    .with("cancelled", "released", () => theme.fg("dim", "■"))
    .with("waiting-question", "budget-exhausted", "stopping", "releasing", () =>
      theme.fg("warning", "!"),
    )
    .with("queued", () => theme.fg("accent", "◦"))
    .with("running", () => theme.fg("accent", activityFrame % 2 === 0 ? "◍" : "●"))
    .otherwise(() => theme.fg("accent", "○"));
}
export function singleLine(text: string): string {
  return terminalText(text).replace(/[\n\r\t]+/g, " ");
}
export function elapsed(start: number, end: number): string {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const WORKER_PRIORITY = {
  "waiting-question": 0,
  running: 1,
  stopping: 2,
  releasing: 2,
  queued: 3,
  idle: 4,
  cancelled: 4,
  "cleanup-unknown": 4,
  released: 4,
  historical: 4,
} satisfies Record<WorkerStatusSnapshot["status"], number>;

function priority(worker: WorkerStatusSnapshot): number {
  return WORKER_PRIORITY[worker.status];
}

export function cancellable(worker: WorkerSnapshot): boolean {
  return (
    worker.liveSession === "available" &&
    match(worker.status)
      .with("queued", "running", "waiting-question", () => true)
      .with(
        "stopping",
        "idle",
        "cancelled",
        "cleanup-unknown",
        "releasing",
        "released",
        "historical",
        () => false,
      )
      .exhaustive()
  );
}

export function widgetLines(options: {
  workers: readonly WorkerStatusSnapshot[];
  observation: (id: string) => ChildObservation | undefined;
  width: number;
  terminalRows: number;
  maxRows?: number;
  now?: number;
  activityFrame?: number;
  hiddenWorkers?: ReadonlySet<string>;
  theme?: DisplayTheme;
  agentName?: (name: string) => string;
  onWorkerRows?: (workerId: string, start: number, end: number) => void;
}): string[] {
  const maxRows = options.maxRows ?? 4;
  if (!Number.isSafeInteger(maxRows) || maxRows < 1)
    throw new Error("Widget row limit must be a positive safe integer");
  const width = Math.max(1, Math.floor(options.width));
  const now = options.now ?? Date.now();
  const warnings: string[] = [];
  const live = options.workers.filter((worker) => worker.liveSession !== "historical");
  if (live.some((worker) => worker.status === "cleanup-unknown"))
    warnings.push("! Delegation blocked: cleanup unknown");
  if (
    live.some((worker) =>
      worker.assignments.some((assignment) => assignment.persistence === "failed"),
    )
  )
    warnings.push("! History save failed; inspect in-memory evidence");
  if (
    live.some((worker) => worker.assignments.some((assignment) => assignment.outcome === "failed"))
  )
    warnings.push("! Assignment failed; inspect history");
  if (
    live.some((worker) =>
      worker.assignments.some((assignment) => assignment.outcome === "budget-exhausted"),
    )
  )
    warnings.push("! Turn budget exhausted; inspect partial evidence");
  const active = live
    .filter((worker) => priority(worker) < 4 && !options.hiddenWorkers?.has(worker.id))
    .map((worker, index) => ({ worker, index }))
    .sort(
      (a, b) =>
        priority(a.worker) - priority(b.worker) ||
        a.worker.createdAt - b.worker.createdAt ||
        a.index - b.index,
    )
    .map(({ worker }) => worker);
  const theme = options.theme ?? plainTheme;
  const name = options.agentName ?? ((value: string) => theme.bold(singleLine(value)));
  const rows = warnings.map((warning) => theme.fg("warning", warning));
  if (!active.length) return rows.map((line) => truncateToWidth(line, width, ""));
  // Leave room for the frame and editor; warnings take precedence on short terminals.
  const room = Math.max(0, Math.min(12, Math.floor(options.terminalRows) - 8) - warnings.length);
  if (room <= 1) {
    if (room) rows.push(theme.fg("dim", `+${active.length} more · /subagents`));
    return rows.map((line) => truncateToWidth(line, width, ""));
  }
  rows.push(theme.fg("accent", "● Agents"));
  let remaining = room - 1;
  let shown = 0;
  for (const worker of active.slice(0, maxRows)) {
    const last = shown === active.length - 1;
    const required = last ? 2 : 3;
    if (remaining < required) break;
    const observation = options.observation(worker.id);
    const assignment = worker.assignments.find((item) => item.id === worker.currentAssignmentId);
    const activity = worker.pendingQuestion
      ? "Answer needed"
      : (observation?.activity ??
        (worker.status === "queued" ? "Waiting for capacity" : worker.status));
    const stats = [
      assignment ? `↻${assignment.turnsUsed}≤${assignment.maxTurns}` : "",
      elapsed(observation?.startedAt ?? worker.createdAt, observation?.endedAt ?? now),
    ]
      .filter(Boolean)
      .join(" · ");
    const branch = last ? "└─" : "├─";
    options.onWorkerRows?.(worker.id, rows.length, rows.length + 2);
    rows.push(
      `${theme.fg("dim", branch)} ${statusGlyph(worker.status, theme, options.activityFrame ?? 0)} ${name(worker.specialist)} ${theme.fg("dim", `[${singleLine(worker.config.model)}]`)}  ${theme.fg("muted", terminalText(truncateToWidth(singleLine(assignment?.prompt ?? ""), Math.min(50, Math.floor(width / 3)), "…")))} ${theme.fg("dim", `· ${stats} · ${worker.status}`)}`,
    );
    rows.push(theme.fg("dim", `${last ? " " : "│"}    ⎿  ${singleLine(activity)}`));
    remaining -= 2;
    shown++;
  }
  if (shown < active.length && remaining > 0)
    rows.push(theme.fg("dim", `└─ +${active.length - shown} more · /subagents`));
  return rows.map((line) => truncateToWidth(line, width, ""));
}

export function workerDetails(worker: WorkerSnapshot, observation?: ChildObservation): string {
  const lines = [
    `${worker.specialist} · ${worker.id}`,
    `State: ${worker.status} | Live session: ${worker.liveSession}`,
    `Model: ${worker.config.model} | Thinking: ${worker.config.thinking ?? "unavailable"}`,
    `Created: ${new Date(worker.createdAt).toISOString()}`,
    `Started: ${observation ? new Date(observation.startedAt).toISOString() : "unavailable"}`,
    `Ended: ${observation?.endedAt === undefined ? "unavailable" : new Date(observation.endedAt).toISOString()}`,
    `Input tokens: ${observation?.inputTokens ?? "unavailable"} | Output tokens: ${observation?.outputTokens ?? "unavailable"}`,
    `Cost: ${observation?.cost ?? "unavailable"}`,
    "Reports are worker evidence, not verified conclusions.",
  ];
  for (const assignment of worker.assignments) {
    lines.push(
      "",
      `Assignment: ${assignment.id}`,
      `Execution: ${assignment.outcome} | Storage: ${assignment.persistence}`,
      `Turns: ${assignment.turnsUsed}/${assignment.maxTurns} | Remaining: ${assignment.remainingTurns}`,
    );
    if (assignment.error) lines.push(`Execution error: ${assignment.error}`);
    if (assignment.persistenceError) lines.push(`Storage error: ${assignment.persistenceError}`);
    if (assignment.report !== undefined) lines.push("", "Final report", assignment.report);
    if (assignment.partialReport !== undefined)
      lines.push("", "Partial report", assignment.partialReport);
    lines.push("", "Transcript");
    for (const entry of assignment.transcript) lines.push(`[${entry.role}]`, entry.text);
  }
  if (worker.pendingQuestion) lines.push("", `Question: ${worker.pendingQuestion.text}`);
  if (observation?.liveText && worker.status === "running")
    lines.push("", "Streaming output", observation.liveText);
  return terminalText(lines.join("\n"));
}
