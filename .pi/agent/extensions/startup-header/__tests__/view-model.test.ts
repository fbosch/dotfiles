import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderStartupHeader } from "../view-model";

const theme = { fg: (_color: string, text: string) => text } as Theme;
const markedTheme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
} as Theme;

test("renders startup timing without context visualization", () => {
  expect(renderStartupHeader(theme, 160, 42.5)).toEqual(["pi", "Startup: 42.5ms"]);
});

test("renders update status with its stale marker and unsupported Git coverage", () => {
  const snapshot = {
    type: "reply" as const,
    schemaVersion: 1 as const,
    sessionId: "session",
    generationId: "generation",
    ownerId: "updates" as const,
    ownerRevision: 1,
    state: "degraded" as const,
    staleAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
    payload: { coverage: "partial", available: 2, gitNotChecked: 1 },
  };
  expect(renderStartupHeader(theme, 160, undefined, undefined, snapshot)).toContain(
    "Updates: 2 updates available (incomplete) (1 Git source not checked) (stale)",
  );
});

test("renders update details as separately wrapped lines and keeps stale marker", () => {
  const snapshot = {
    type: "reply" as const,
    schemaVersion: 1 as const,
    sessionId: "session",
    generationId: "generation",
    ownerId: "updates" as const,
    ownerRevision: 1,
    state: "degraded" as const,
    staleAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
    payload: {
      coverage: "partial",
      available: 1,
      updates: [{ name: "@acme/tool", current: "1.0.0", latest: "2.0.0", scope: "user" }],
    },
  };
  const lines = renderStartupHeader(theme, 30, undefined, undefined, snapshot);
  expect(lines).toContain("Updates: 1 update available");
  expect(lines).toContain("(incomplete) (stale)");
  expect(lines).toContain("  @acme/tool 1.0.0 → 2.0.0");
  expect(lines.every((line) => !line.includes("\\\\n"))).toBe(true);
  expect(lines.every((line) => line.length <= 30)).toBe(true);
});

test("renders Update all beneath complete, fresh update details", () => {
  const now = Date.now();
  const snapshot = {
    type: "reply" as const,
    schemaVersion: 1 as const,
    sessionId: "session",
    generationId: "generation",
    ownerId: "updates" as const,
    ownerRevision: 1,
    state: "ready" as const,
    staleAt: now + 60_000,
    expiresAt: now + 120_000,
    payload: {
      coverage: "complete",
      available: 1,
      updates: [{ name: "@acme/tool", current: "1.0.0", latest: "2.0.0", scope: "user" }],
    },
  };

  const lines = renderStartupHeader(
    theme,
    80,
    undefined,
    undefined,
    snapshot,
    undefined,
    undefined,
    undefined,
    undefined,
    "ready",
  );
  const detailRow = lines.findIndex((line) => line.includes("@acme/tool 1.0.0 → 2.0.0"));
  const buttonRow = lines.findIndex((line) => line.includes("[ Update all ]"));
  expect(buttonRow).toBeGreaterThan(detailRow);
  expect(lines[buttonRow]).toContain("Ctrl+Alt+U");
});

test("colors only changed version segments by upgrade size and preserves wrapped ANSI text", () => {
  const snapshot = {
    type: "reply" as const,
    schemaVersion: 1 as const,
    sessionId: "session",
    generationId: "generation",
    ownerId: "updates" as const,
    ownerRevision: 1,
    state: "ready" as const,
    expiresAt: Number.MAX_SAFE_INTEGER,
    payload: {
      coverage: "complete",
      available: 4,
      updates: [
        { name: "major", current: "v1.2.3", latest: "v2.0.0", scope: "user" },
        { name: "minor", current: "1.2.3", latest: "1.3.0", scope: "user" },
        { name: "patch", current: "1.2.3", latest: "1.2.4", scope: "user" },
        { name: "pre", current: "1.2.3-beta.1", latest: "1.2.3-beta.2+build", scope: "user" },
      ],
    },
  };
  const lines = renderStartupHeader(markedTheme, 1000, undefined, undefined, snapshot);
  const rendered = lines.join("\\n");
  expect(rendered).toContain(
    "<error>2</error><muted>.</muted><error>0</error><muted>.</muted><error>0</error>",
  );
  expect(rendered).toContain(
    "<muted>1</muted><muted>.</muted><warning>3</warning><muted>.</muted><warning>0</warning>",
  );
  expect(rendered).toContain(
    "<muted>1</muted><muted>.</muted><muted>2</muted><muted>.</muted><success>4</success>",
  );
  expect(rendered).toContain("<accent>-beta.2+build</accent>");
  expect(rendered).toContain("<muted>  major v1.2.3 → v</muted>");

  const colors: Record<string, number> = {
    muted: 90,
    error: 31,
    warning: 33,
    success: 32,
    accent: 36,
  };
  const ansiTheme = {
    fg: (color: string, text: string) => `\x1b[${colors[color] ?? 37}m${text}\x1b[39m`,
  } as Theme;
  const wrapped = renderStartupHeader(ansiTheme, 28, undefined, undefined, snapshot);
  expect(wrapped.every((line) => visibleWidth(line) <= 28)).toBe(true);
  const plain = wrapped.map(stripVTControlCharacters).join("");
  expect(plain).toContain("major v1.2.3 → v2.0.0");
  expect(plain).toMatch(/pre 1\.2\.3-beta\.1 →\s*1\.2\.3-beta\.2\+build/);
  expect(wrapped.join("")).toContain("\x1b[31m2");
});

test("hides complete zero-update results but retains incomplete and failed notices", () => {
  const snapshot = {
    type: "reply" as const,
    schemaVersion: 1 as const,
    sessionId: "session",
    generationId: "generation",
    ownerId: "updates" as const,
    ownerRevision: 1,
    state: "ready" as const,
    payload: { coverage: "complete", available: 0 },
  };
  expect(renderStartupHeader(theme, 160, undefined, undefined, snapshot)).toEqual(["pi"]);
  for (const [payload, notice] of [
    [{ coverage: "partial", available: 0 }, "Updates: update check incomplete"],
    [{ coverage: "failed" }, "Updates: updates failed"],
    [{ coverage: "offline" }, "Updates: updates offline"],
  ] as const) {
    expect(
      renderStartupHeader(theme, 160, undefined, undefined, { ...snapshot, payload }),
    ).toContain(notice);
  }
});

test("omits expired update observations instead of rendering stale zero as fresh", () => {
  const snapshot = {
    type: "reply" as const,
    schemaVersion: 1 as const,
    sessionId: "session",
    generationId: "generation",
    ownerId: "updates" as const,
    ownerRevision: 1,
    state: "ready" as const,
    expiresAt: 1,
    payload: { coverage: "complete", available: 0 },
  };
  expect(renderStartupHeader(theme, 160, undefined, undefined, snapshot)).not.toContain("Updates:");
});
