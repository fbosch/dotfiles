import type { Theme } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { type CandidateInspection, candidateView, formatCandidateView } from "./candidates";
import { type ContextStripConfig, renderInitialContextStrip } from "./context-strip";
import type { StartupOwnerSnapshot } from "./contracts";
import { readAuthStartupPayload, readLspStartupPayload } from "./owner-payloads";
import { readContextEstimate, readStartupRuntimeSnapshot } from "./runtime-capability";
import type { StartupRuntimeSnapshot } from "./runtime-types";
import { sanitizeHeaderField } from "./sanitize";
import type { WorkspaceIdentity } from "./workspace";

export interface StartupIntegrationSnapshots {
  readonly neovim: StartupOwnerSnapshot | undefined;
  readonly direnv: StartupOwnerSnapshot | undefined;
  readonly lsp: StartupOwnerSnapshot | undefined;
}

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
  integrations?: StartupIntegrationSnapshots,
  candidates?: CandidateInspection,
  auth?: StartupOwnerSnapshot,
  contextConfig?: ContextStripConfig,
  context?: StartupOwnerSnapshot,
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
  const integrationStatus = renderIntegrationStatus(integrations);
  if (integrationStatus !== "") lines.push(theme.fg("muted", integrationStatus));
  if (candidates !== undefined) {
    lines.push(
      theme.fg(
        "muted",
        [
          formatCandidateView(candidateView("formatter", candidates.formatter)),
          formatCandidateView(candidateView("lsp", candidates.lsp)),
        ].join(" · "),
      ),
    );
  }
  const authStatus = renderAuthStatus(auth, Date.now());
  if (authStatus !== "") lines.push(theme.fg("muted", authStatus));
  const contextEstimate =
    context?.state === "ready" ? readContextEstimate(context.payload) : undefined;
  if (contextEstimate !== undefined && contextConfig !== undefined) {
    const strip = renderInitialContextStrip(theme, contextEstimate, contextConfig);
    if (strip !== "") lines.push(strip);
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
        `${extensions.enabled} extensions${failure}${extensionProject}${updateStatus} · ${skills.available} skills${skillProject}`,
      ),
    );
  }
  if (width <= 0) return [];
  return lines.flatMap((line) => wrapTextWithAnsi(line, width));
}

function renderIntegrationStatus(snapshots: StartupIntegrationSnapshots | undefined): string {
  if (snapshots === undefined) return "";
  const statuses = [
    renderIntegration("nvim", snapshots.neovim),
    renderIntegration("direnv", snapshots.direnv),
    renderIntegration("lsp", snapshots.lsp),
  ].filter((status) => status !== "");
  return statuses.join(" · ");
}

function renderIntegration(
  label: "nvim" | "direnv" | "lsp",
  snapshot: StartupOwnerSnapshot | undefined,
): string {
  if (snapshot === undefined) return "";
  if (label === "lsp" && snapshot.state === "ready") {
    const payload = readLspStartupPayload(snapshot.payload);
    if (
      payload === undefined ||
      !("observedDocuments" in payload) ||
      payload.observedDocuments === 0
    ) {
      return "lsp ?";
    }
  }
  const marker = snapshot.state === "ready" ? "✓" : snapshot.state === "degraded" ? "!" : "?";
  return `${label} ${marker}`;
}

function renderAuthStatus(snapshot: StartupOwnerSnapshot | undefined, now: number): string {
  if (snapshot === undefined) return "";
  if (snapshot.state === "unavailable") return "auth: missing";
  const payload = readAuthStartupPayload(snapshot.payload);
  if (payload === undefined) {
    return snapshot.state === "collecting" ? "auth: not reported" : "auth: unavailable";
  }
  const nextProfile = payload.profiles.find(
    (profile) => profile.profileLabel !== payload.activeProfile,
  )?.profileLabel;
  const profiles = payload.profiles.map((profile) => {
    const active = profile.profileLabel === payload.activeProfile ? "*" : "";
    const next = profile.profileLabel === nextProfile ? " [next]" : "";
    if (profile.status === "not-reported") {
      return `${profile.profileLabel}${active}${next}: not reported`;
    }
    const identity = [profile.provider, profile.method].filter(isDefined).join("/");
    const windows = profile.windows.map((window) => {
      const reset =
        window.allowanceResetAt === undefined
          ? ""
          : ` reset ${formatDeadline(window.allowanceResetAt, now)}`;
      return `${window.windowId} ${window.remaining}%${reset}`;
    });
    const banked =
      profile.bankedResetCount === undefined
        ? ""
        : ` · ${profile.bankedResetCount} banked${
            profile.bankedExpiryAt === undefined
              ? ""
              : ` expires ${formatDeadline(profile.bankedExpiryAt, now)}`
          }`;
    const problem = profile.status === "errored" ? " !" : "";
    return `${profile.profileLabel}${active}${next}${identity === "" ? "" : ` [${identity}]`}${problem}: ${windows.join(", ") || "no usage"}${banked}`;
  });
  const freshness =
    snapshot.state !== "degraded"
      ? ""
      : snapshot.staleAt !== undefined && snapshot.staleAt <= now
        ? " stale"
        : " degraded";
  return `auth${freshness}: ${profiles.join(" · ")}`;
}

function formatDeadline(timestamp: number, now: number): string {
  const remaining = Math.max(0, timestamp - now);
  if (remaining === 0) return "now";
  if (remaining < 60_000) return `${Math.ceil(remaining / 1_000)}s`;
  if (remaining < 3_600_000) return `${Math.ceil(remaining / 60_000)}m`;
  if (remaining < 86_400_000) return `${Math.ceil(remaining / 3_600_000)}h`;
  return `${Math.ceil(remaining / 86_400_000)}d`;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
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
