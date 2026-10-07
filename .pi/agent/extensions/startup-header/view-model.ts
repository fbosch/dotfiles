import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { renderStartupHeaderArt, type StartupHeaderArt } from "./ascii-art";
import { type CandidateInspection, formatCandidateView } from "./candidates";
import type { ClassifierStartupStatus } from "./classifier-status";
import type { StartupOwnerSnapshot } from "./contracts";
import {
  type AuthStartupProfile,
  readAuthStartupPayload,
  readLspStartupPayload,
} from "./owner-payloads";
import { readAvailableUpdates, readUpdateCoverage, type UpdateDetail } from "./updates";
import type { WorkspaceIdentity } from "./workspace";

export const UPDATE_ALL_BUTTON_TEXT = "[ Update all ]";
const UPDATE_ALL_SHORTCUT_TEXT = "Ctrl+Alt+U";

type UpdateActionState = "ready" | "updating" | "reloading";

export interface StartupIntegrationSnapshots {
  readonly neovim: StartupOwnerSnapshot | undefined;
  readonly direnv: StartupOwnerSnapshot | undefined;
  readonly lsp: StartupOwnerSnapshot | undefined;
  readonly classifier?: ClassifierStartupStatus | undefined;
}

export function renderStartupHeader(
  theme: Theme,
  width: number,
  startupElapsedMs?: number,
  _workspace?: WorkspaceIdentity,
  updates?: StartupOwnerSnapshot,
  integrations?: StartupIntegrationSnapshots,
  candidates?: CandidateInspection,
  auth?: StartupOwnerSnapshot,
  art?: StartupHeaderArt,
  updateActionState?: UpdateActionState,
  now = Date.now(),
): string[] {
  if (width <= 0) return [];

  const lines = renderStartupHeaderArt(theme, width, art);

  const integrationStatus = renderIntegrationStatus(theme, integrations);
  if (integrationStatus !== "") lines.push("", integrationStatus);

  if (candidates !== undefined) {
    lines.push("", theme.fg("muted", formatCandidateView(candidates.lsp).replace(/^lsp:/, "LSP:")));
  }

  const authLines = renderAuthStatus(theme, width, auth, now);
  if (authLines.length > 0) lines.push("", ...authLines, "");

  const updateStatus = renderUpdateStatus(theme, updates, now);
  if (updateStatus.length > 0) {
    lines.push(theme.fg("muted", `Updates: ${updateStatus[0]}`));
    lines.push(...updateStatus.slice(1));
  }
  if (updateActionState !== undefined && readAvailableUpdates(updates, now) !== undefined) {
    const actionLine = renderUpdateAction(theme, updateActionState, width);
    if (actionLine !== undefined) lines.push(actionLine);
  }

  if (startupElapsedMs !== undefined) {
    lines.push(theme.fg("muted", `Startup: ${formatStartupDuration(startupElapsedMs)}`));
  }

  return lines.flatMap((line) => (line === "" ? [line] : wrapTextWithAnsi(line, width)));
}
// Cache the visible time state, not clock ticks, so deadlines still change at their exact boundaries.
export function startupHeaderTimeKey(
  auth: StartupOwnerSnapshot | undefined,
  updates: StartupOwnerSnapshot | undefined,
  now: number,
): string {
  const profiles = readAuthStartupPayload(auth?.payload)?.profiles ?? [];
  const coverage = readUpdateCoverage(updates?.payload);
  return JSON.stringify([
    auth?.staleAt !== undefined && auth.staleAt <= now,
    profiles.map((profile) => [
      bankedResetDisplay(profile, now),
      profile.windows.map((window) =>
        window.allowanceResetAt === undefined
          ? undefined
          : formatDeadline(window.allowanceResetAt, now),
      ),
    ]),
    [updates?.staleAt ?? coverage?.staleAt, updates?.expiresAt ?? coverage?.expiresAt].map(
      (deadline) => deadline !== undefined && deadline <= now,
    ),
  ]);
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
    renderIntegration(theme, "classifier", snapshots.classifier),
  ]
    .filter((status) => status !== "")
    .join("  ");
}

function renderIntegration(
  theme: Theme,
  label: "nvim" | "direnv" | "lsp" | "classifier",
  snapshot: Pick<StartupOwnerSnapshot, "state" | "payload"> | undefined,
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

  const profiles = payload.profiles.filter((profile) => profile.profileLabel !== "default");
  if (profiles.length === 0) return [];
  const nextProfile = profiles.find(
    (profile) =>
      profile.profileLabel !== payload.activeProfile &&
      !profile.windows.some((window) => window.remaining <= 0),
  )?.profileLabel;
  const stale =
    snapshot.state === "degraded"
      ? snapshot.staleAt !== undefined && snapshot.staleAt <= now
        ? " stale"
        : " degraded"
      : "";
  if (width < 76)
    return renderCompactAuth(theme, profiles, payload.activeProfile, nextProfile, stale, now);

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

  for (const [profileIndex, profile] of profiles.entries()) {
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

function renderUpdateStatus(
  theme: Theme,
  snapshot: StartupOwnerSnapshot | undefined,
  now: number,
): string[] {
  if (snapshot === undefined || (snapshot.state !== "ready" && snapshot.state !== "degraded")) {
    return [];
  }
  const payload = readUpdateCoverage(snapshot.payload);
  if (payload === undefined) return [];
  if (payload.coverage === "complete" && payload.available === 0) return [];
  const expiresAt = snapshot.expiresAt ?? payload.expiresAt;
  if (expiresAt !== undefined && expiresAt <= now) return [];

  let status: string;
  if (payload.coverage === "offline") status = ", updates offline";
  else if (payload.coverage === "failed") status = ", updates failed";
  else if (payload.coverage === "partial") {
    status =
      payload.available === 0
        ? ", update check incomplete"
        : `, ${payload.available} ${payload.available === 1 ? "update" : "updates"} available (incomplete)`;
  } else if (payload.coverage === "complete") {
    status = `, ${payload.available} ${payload.available === 1 ? "update" : "updates"} available`;
  } else {
    return [];
  }

  const notes = [
    payload.gitNotChecked === undefined || payload.gitNotChecked === 0
      ? undefined
      : `${payload.gitNotChecked} Git ${payload.gitNotChecked === 1 ? "source" : "sources"} not checked`,
    payload.unsupported === undefined || payload.unsupported === 0
      ? undefined
      : `${payload.unsupported} unsupported ${payload.unsupported === 1 ? "source" : "sources"}`,
    payload.failed === undefined || payload.failed === 0
      ? undefined
      : `${payload.failed} npm ${payload.failed === 1 ? "check" : "checks"} failed`,
  ].filter(isDefined);
  if (notes.length > 0) status += ` (${notes.join("; ")})`;
  const staleAt = snapshot.staleAt ?? payload.staleAt;
  const result = [`${status.slice(2)}${staleAt !== undefined && staleAt <= now ? " (stale)" : ""}`];
  if (
    (payload.coverage === "complete" || payload.coverage === "partial") &&
    payload.available > 0 &&
    payload.updates !== undefined
  ) {
    result.push(...payload.updates.map((update) => renderUpdateDetail(theme, update)));
  }
  return result;
}

function renderUpdateDetail(theme: Theme, update: UpdateDetail): string {
  const current = parseVersion(update.current);
  const latest = parseVersion(update.latest);
  if (current === undefined || latest === undefined) {
    return theme.fg("muted", `  ${update.name} ${update.current} → ${update.latest}`);
  }

  const changedIndex = latest.parts.findIndex((part, index) => part !== current.parts[index]);
  const color: ThemeColor =
    changedIndex === 0
      ? "error"
      : changedIndex === 1
        ? "warning"
        : changedIndex === 2
          ? "success"
          : "accent";
  const target = latest.parts
    .map((part, index) => theme.fg(part !== current.parts[index] ? color : "muted", part))
    .join(theme.fg("muted", "."));
  const suffix =
    latest.suffix === ""
      ? ""
      : theme.fg(latest.suffix !== current.suffix ? color : "muted", latest.suffix);
  return (
    theme.fg("muted", `  ${update.name} ${update.current} → ${latest.prefix}`) + target + suffix
  );
}

function parseVersion(
  version: string,
): { prefix: string; parts: readonly string[]; suffix: string } | undefined {
  const match = /^(v?)(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version);
  if (match === null) return undefined;
  return {
    prefix: match[1] ?? "",
    parts: [match[2] ?? "", match[3] ?? "", match[4] ?? ""],
    suffix: match[5] ?? "",
  };
}

function renderUpdateAction(
  theme: Theme,
  state: UpdateActionState,
  width: number,
): string | undefined {
  if (state === "updating") return theme.fg("muted", "Updating packages…");
  if (state === "reloading") return theme.fg("success", "Reloading Pi to activate updates…");
  const buttonWidth = visibleWidth(UPDATE_ALL_BUTTON_TEXT);
  if (width < buttonWidth) return undefined;
  const shortcut = ` ${UPDATE_ALL_SHORTCUT_TEXT}`;
  return (
    theme.fg("accent", UPDATE_ALL_BUTTON_TEXT) +
    (width >= buttonWidth + visibleWidth(shortcut) ? theme.fg("muted", shortcut) : "")
  );
}

function formatStartupDuration(milliseconds: number): string {
  return milliseconds < 1_000
    ? `${milliseconds.toFixed(milliseconds < 100 ? 1 : 0)}ms`
    : `${(milliseconds / 1_000).toFixed(2)}s`;
}
