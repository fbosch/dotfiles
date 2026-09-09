import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { type CandidateInspection, candidateView, formatCandidateView } from "./candidates";
import { type ContextStripConfig, renderInitialContextStrip } from "./context-strip";
import type { StartupOwnerSnapshot } from "./contracts";
import {
  type AuthStartupProfile,
  readAuthStartupPayload,
  readLspStartupPayload,
} from "./owner-payloads";
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
  if (width <= 0) return [];

  const lines = [theme.fg("accent", "pi")];
  if (workspace !== undefined) {
    const branch = workspace.detached
      ? "detached HEAD"
      : sanitizeHeaderField(workspace.branch ?? "");
    const linkedPath = workspace.linkedWorktree
      ? ` · Worktree: ${sanitizeHeaderField(workspace.root)}`
      : "";
    lines.push(theme.fg("muted", `Branch: ${branch}${linkedPath}`));
  }

  const integrationStatus = renderIntegrationStatus(theme, integrations);
  if (integrationStatus !== "") lines.push("", integrationStatus);

  if (candidates !== undefined) {
    lines.push(
      "",
      theme.fg(
        "muted",
        formatCandidateView(candidateView("formatter", candidates.formatter)).replace(
          /^formatters:/,
          "Formatters:",
        ),
      ),
      theme.fg(
        "muted",
        formatCandidateView(candidateView("lsp", candidates.lsp)).replace(
          /^lsp candidates:/,
          "LSP:",
        ),
      ),
    );
  }

  const authLines = renderAuthStatus(theme, width, auth, Date.now());
  if (authLines.length > 0) lines.push("", ...authLines, "");

  const contextEstimate =
    context?.state === "ready" ? readContextEstimate(context.payload) : undefined;
  if (contextEstimate !== undefined && contextConfig !== undefined) {
    const strip = renderInitialContextStrip(theme, contextEstimate, contextConfig);
    if (strip !== "") lines.push(strip);
  }

  if (runtime?.resources.status === "ready") {
    const { extensions, skills } = runtime.resources.value;
    const extensionProject = extensions.project === 0 ? "" : ` (${extensions.project} project)`;
    const failure = extensions.loadFailed === 0 ? "" : `, ${extensions.loadFailed} failed`;
    const updateStatus = renderUpdateStatus(updates);
    const skillProject = skills.project === 0 ? "" : ` (${skills.project} project)`;
    lines.push(
      theme.fg(
        "muted",
        `Extensions: ${extensions.enabled} enabled${failure}${extensionProject}${updateStatus}`,
      ),
      theme.fg("muted", `Skills: ${skills.available} available${skillProject}`),
    );
  }

  if (startupElapsedMs !== undefined) {
    lines.push(theme.fg("muted", `Startup: ${formatStartupDuration(startupElapsedMs)}`));
  }

  return lines.flatMap((line) => (line === "" ? [line] : wrapTextWithAnsi(line, width)));
}
function renderIntegrationStatus(
  theme: Theme,
  snapshots: StartupIntegrationSnapshots | undefined,
): string {
  if (snapshots === undefined) return "";
  return [
    renderIntegration(theme, "nvim", snapshots.neovim),
    renderIntegration(theme, "direnv", snapshots.direnv),
    renderIntegration(theme, "lsp", snapshots.lsp),
  ]
    .filter((status) => status !== "")
    .join("  ");
}

function renderIntegration(
  theme: Theme,
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
      return theme.fg("warning", "lsp ?");
    }
  }
  const marker = snapshot.state === "ready" ? "✓" : snapshot.state === "degraded" ? "!" : "?";
  const color: ThemeColor =
    snapshot.state === "ready" ? "success" : snapshot.state === "degraded" ? "warning" : "muted";
  return theme.fg(color, `${label} ${marker}`);
}

function renderAuthStatus(
  theme: Theme,
  width: number,
  snapshot: StartupOwnerSnapshot | undefined,
  now: number,
): string[] {
  if (snapshot === undefined) return [];
  if (snapshot.state === "unavailable") return [theme.fg("muted", "auth: missing")];
  const payload = readAuthStartupPayload(snapshot.payload);
  if (payload === undefined) {
    return [
      theme.fg(
        "muted",
        snapshot.state === "collecting" ? "auth: not reported" : "auth: unavailable",
      ),
    ];
  }

  const nextProfile = payload.profiles.find(
    (profile) => profile.profileLabel !== payload.activeProfile,
  )?.profileLabel;
  const stale =
    snapshot.state === "degraded"
      ? snapshot.staleAt !== undefined && snapshot.staleAt <= now
        ? " stale"
        : " degraded"
      : "";
  if (width < 76)
    return renderCompactAuth(
      theme,
      payload.profiles,
      payload.activeProfile,
      nextProfile,
      stale,
      now,
    );

  const columns = [17, 14, 12, 16] as const;
  const border = (left: string, join: string, right: string) =>
    theme.fg(
      "border",
      `${left}${columns.map((column) => "─".repeat(column + 2)).join(join)}${right}`,
    );
  const lines = [
    border("┌", "┬", "┐"),
    tableRow(theme, columns, [
      { text: "Profile", color: "muted" },
      { text: "Window", color: "muted" },
      { text: "Week", color: "muted" },
      { text: "Banked resets", color: "muted" },
    ]),
    border("├", "┼", "┤"),
  ];

  for (const [profileIndex, profile] of payload.profiles.entries()) {
    if (profileIndex > 0) lines.push(border("├", "┼", "┤"));
    const active = profile.profileLabel === payload.activeProfile;
    const next = profile.profileLabel === nextProfile;
    const profileLabel = `${profile.profileLabel}${active ? " [active]" : next ? " [next]" : ""}${profile.status === "errored" ? " !" : ""}`;
    const profileColor: ThemeColor = active
      ? "success"
      : next
        ? "accent"
        : profile.status === "errored"
          ? "warning"
          : "text";
    const method = displayAuthMethod(profile);
    const [window, week] = profile.windows;
    const banked = bankedResetDisplay(profile, now);

    if (profile.status === "not-reported") {
      lines.push(
        tableRow(theme, columns, [
          { text: profileLabel, color: profileColor },
          { text: "", color: "muted" },
          { text: "", color: "muted" },
          { text: "", color: "muted" },
        ]),
        tableRow(theme, columns, [
          { text: method, color: "muted" },
          { text: "", color: "muted" },
          { text: "", color: "muted" },
          { text: "", color: "muted" },
        ]),
      );
      continue;
    }

    lines.push(
      tableRow(theme, columns, [
        { text: profileLabel, color: profileColor },
        { text: allowanceDisplay(window), color: allowanceColor(window) },
        { text: allowanceDisplay(week), color: allowanceColor(week) },
        { text: banked.count, color: banked.color },
      ]),
      tableRow(theme, columns, [
        { text: method, color: "muted" },
        { text: resetDisplay(window, now), color: "muted" },
        { text: resetDisplay(week, now), color: "muted" },
        { text: banked.expiry, color: banked.color },
      ]),
    );
  }

  lines.push(border("└", "┴", "┘"));
  return lines;
}

interface TableCell {
  readonly text: string;
  readonly color: ThemeColor;
}

function tableRow(theme: Theme, columns: readonly number[], cells: readonly TableCell[]): string {
  const rendered = cells.map((cell, index) => {
    const padded = fit(cell.text, columns[index] ?? 1);
    const styled = theme.fg(cell.color, padded);
    return ` ${styled} `;
  });
  return `${theme.fg("border", "│")}${rendered.join(theme.fg("border", "│"))}${theme.fg("border", "│")}`;
}

function displayAuthMethod(profile: AuthStartupProfile): string {
  if (profile.method === "oauth") return "OAuth";
  if (profile.method === "api-key") return "API key";
  return profile.method ?? profile.provider ?? "";
}

function allowanceDisplay(window: AuthStartupProfile["windows"][number] | undefined): string {
  return window === undefined ? "" : `${window.remaining}% left`;
}

function allowanceColor(window: AuthStartupProfile["windows"][number] | undefined): ThemeColor {
  if (window === undefined) return "muted";
  if (window.remaining <= 20) return "error";
  if (window.remaining <= 50) return "warning";
  return "success";
}

function resetDisplay(
  window: AuthStartupProfile["windows"][number] | undefined,
  now: number,
): string {
  return window?.allowanceResetAt === undefined
    ? ""
    : `resets ${formatDeadline(window.allowanceResetAt, now)}`;
}

function bankedResetDisplay(
  profile: AuthStartupProfile,
  now: number,
): { readonly count: string; readonly expiry: string; readonly color: ThemeColor } {
  if (profile.bankedResetCount === undefined) return { count: "", expiry: "", color: "muted" };
  const expiryRemaining =
    profile.bankedExpiryAt === undefined ? undefined : Math.max(0, profile.bankedExpiryAt - now);
  const color: ThemeColor =
    expiryRemaining === undefined
      ? "muted"
      : expiryRemaining <= 86_400_000
        ? "error"
        : expiryRemaining <= 7 * 86_400_000
          ? "warning"
          : "success";
  return {
    count: `${profile.bankedResetCount} available`,
    expiry:
      profile.bankedExpiryAt === undefined
        ? ""
        : `expires in ${formatDeadline(profile.bankedExpiryAt, now)}`,
    color,
  };
}

function renderCompactAuth(
  theme: Theme,
  profiles: readonly AuthStartupProfile[],
  activeProfile: string | undefined,
  nextProfile: string | undefined,
  stale: string,
  now: number,
): string[] {
  const lines = [theme.fg("muted", `auth${stale}`)];
  for (const profile of profiles) {
    const active = profile.profileLabel === activeProfile ? " [active]" : "";
    const next = profile.profileLabel === nextProfile ? " [next]" : "";
    const identity = [profile.provider, profile.method].filter(isDefined).join("/");
    lines.push(
      theme.fg(
        "muted",
        `${profile.profileLabel}${active}${next}${identity === "" ? "" : ` [${identity}]`}`,
      ),
    );
    if (profile.status === "not-reported") continue;
    for (const window of profile.windows) {
      const reset =
        window.allowanceResetAt === undefined
          ? ""
          : ` · reset ${formatDeadline(window.allowanceResetAt, now)}`;
      lines.push(
        theme.fg(allowanceColor(window), `  ${window.windowId}: ${window.remaining}%${reset}`),
      );
    }
  }
  return lines;
}

function fit(value: string, width: number): string {
  if (visibleWidth(value) <= width) return value.padEnd(width - visibleWidth(value) + value.length);
  let fitted = "";
  for (const character of value) {
    if (visibleWidth(`${fitted}${character}…`) > width) break;
    fitted += character;
  }
  return `${fitted}…`.padEnd(width - visibleWidth(`${fitted}…`) + fitted.length + 1);
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
  if (coverage === "offline") return ", updates offline";
  if (coverage === "failed") return ", updates failed";
  if (typeof available !== "number" || !Number.isSafeInteger(available) || available < 0) return "";
  if (coverage === "partial") {
    return available === 0
      ? ", update check incomplete"
      : `, ${available} updates available (incomplete)`;
  }
  if (coverage !== "complete") return "";
  return `, ${available} ${available === 1 ? "update" : "updates"} available`;
}

function formatStartupDuration(milliseconds: number): string {
  return milliseconds < 1_000
    ? `${milliseconds.toFixed(milliseconds < 100 ? 1 : 0)}ms`
    : `${(milliseconds / 1_000).toFixed(2)}s`;
}
