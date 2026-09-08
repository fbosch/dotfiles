import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { StartupOwnerSnapshot } from "./contracts";
import { readStartupRuntimeSnapshot } from "./runtime-capability";
import type { StartupRuntimeSnapshot } from "./runtime-types";
import { sanitizeHeaderField } from "./sanitize";
import type { WorkspaceIdentity } from "./workspace";

export class StartupRuntimeStore {
  private snapshot: StartupRuntimeSnapshot | undefined;

  public accept(value: unknown): boolean {
    const candidate = readStartupRuntimeSnapshot(value);
    if (candidate === undefined) return false;
    if (
      this.snapshot !== undefined &&
      (candidate.sessionId !== this.snapshot.sessionId ||
        candidate.generationId !== this.snapshot.generationId ||
        candidate.ownerRevision <= this.snapshot.ownerRevision)
    ) {
      return false;
    }
    this.snapshot = candidate;
    return true;
  }

  public get(): StartupRuntimeSnapshot | undefined {
    return this.snapshot;
  }

  public clear(): void {
    this.snapshot = undefined;
  }
}

export function renderStartupHeader(
  theme: Theme,
  width: number,
  runtime: StartupRuntimeSnapshot | undefined,
  startupElapsedMs?: number,
  workspace?: WorkspaceIdentity,
  updates?: StartupOwnerSnapshot,
): string[] {
  const startup =
    startupElapsedMs === undefined ? "" : ` · ${formatStartupDuration(startupElapsedMs)}`;
  const title = `${theme.fg("accent", "π")} ${theme.fg("text", `Session${startup}`)}`;
  const lines = [title];
  if (workspace !== undefined) {
    const branch = workspace.detached ? "detached" : sanitizeHeaderField(workspace.branch ?? "");
    const linkedPath = workspace.linkedWorktree
      ? ` · worktree ${sanitizeHeaderField(workspace.root)}`
      : "";
    lines.push(theme.fg("muted", `${branch}${linkedPath}`));
  }
  if (runtime?.resources.status === "ready") {
    const { extensions, skills } = runtime.resources.value;
    const extensionProject = extensions.project === 0 ? "" : ` (${extensions.project} project)`;
    const failure = extensions.loadFailed === 0 ? "" : ` · ${extensions.loadFailed} failed`;
    const updateStatus = renderUpdateStatus(updates);
    const skillProject = skills.project === 0 ? "" : ` (${skills.project} project)`;
    lines.push(
      theme.fg(
        "muted",
        `${extensions.enabled} extensions${extensionProject}${failure}${updateStatus} · ${skills.available} skills${skillProject}`,
      ),
    );
  }
  return lines.map((line) => truncateToWidth(line, Math.max(0, width), ""));
}

function renderUpdateStatus(snapshot: StartupOwnerSnapshot | undefined): string {
  if (snapshot === undefined || (snapshot.state !== "ready" && snapshot.state !== "degraded")) {
    return "";
  }
  if (typeof snapshot.payload !== "object" || snapshot.payload === null) return "";
  const payload = snapshot.payload as Record<string, unknown>;
  const available = payload.available;
  const coverage = payload.coverage;
  if (coverage === "offline") return " · updates offline";
  if (coverage === "failed") return " · updates failed";
  if (typeof available !== "number" || !Number.isSafeInteger(available) || available < 0) return "";
  if (coverage === "partial") {
    return available === 0 ? " · updates incomplete" : ` · ${available} updates (incomplete)`;
  }
  if (coverage !== "complete") return "";
  return ` · ${available} ${available === 1 ? "update" : "updates"}`;
}

function formatStartupDuration(milliseconds: number): string {
  return milliseconds < 1_000
    ? `${milliseconds.toFixed(milliseconds < 100 ? 1 : 0)}ms`
    : `${(milliseconds / 1_000).toFixed(2)}s`;
}
