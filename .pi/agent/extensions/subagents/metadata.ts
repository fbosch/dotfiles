import type { ChildObservation } from "./driver";
import type { WorkerSnapshot } from "./owner";
import { singleLine } from "./presentation";

/** Runtime fields describe the latest resolved response, not guesses from preset names. */
export function workerMetadata(worker: WorkerSnapshot, observation?: ChildObservation, expanded = false, now = Date.now()): string[] {
  const assignment = worker.assignments.find((item) => item.id === worker.currentAssignmentId);
  const state = worker.status === "idle" || worker.status === "historical" ? assignment?.outcome ?? worker.status : worker.status;
  const label = state.replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase());
  const availability = worker.status === "idle" && worker.liveSession === "available" ? "Ready to continue"
    : worker.liveSession === "historical" ? "Historical" : worker.liveSession === "released" ? "Session released" : "";
  const row = (name: string, value: string) => `${name.padEnd(10)} ${value}`;
  const resolved = observation?.resolvedModel;
  const lines = [
    [label, availability].filter(Boolean).join(" · "),
    "",
    row("Model", resolved && resolved !== worker.config.model ? `${worker.config.model} → ${resolved}` : worker.config.model),
  ];
  if (observation?.resolvedThinking !== undefined) lines.push(row("Thinking", observation.resolvedThinking));
  if (observation) {
    const end = worker.status === "running" ? now : observation.endedAt;
    if (end !== undefined) lines.push(row("Duration", `${(Math.max(0, end - observation.startedAt) / 1000).toFixed(1)} s`));
  }
  if (assignment) lines.push(row("Turns", `${assignment.turnsUsed} / ${assignment.maxTurns}`));
  lines.push(row("Tokens", `${observation?.inputTokens ?? "—"} input · ${observation?.outputTokens ?? "—"} output`));
  lines.push(row("Cost", observation?.cost === undefined ? "—" : String(observation.cost)));
  if (expanded) {
    lines.push("", row("Worker ID", worker.id), row("State", `${worker.status} · ${worker.liveSession}`), row("Created", new Date(worker.createdAt).toISOString()));
    if (observation) lines.push(row("Started", new Date(observation.startedAt).toISOString()));
    if (observation?.endedAt !== undefined) lines.push(row("Ended", new Date(observation.endedAt).toISOString()));
    if (worker.config.thinking !== undefined) lines.push(row("Requested", `${worker.config.thinking} thinking`));
    if (resolved && resolved !== worker.config.model) lines.push("Model and thinking reflect the latest resolved response.");
  }
  return lines.map(singleLine);
}
