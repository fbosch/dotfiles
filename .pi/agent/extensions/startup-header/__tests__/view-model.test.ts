import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { StartupOwnerSnapshot } from "../contracts";
import type { StartupRuntimeSnapshot } from "../runtime-types";
import { renderStartupHeader } from "../view-model";

const theme = { fg: (_color: string, text: string) => text } as Theme;

function runtime(
  extensions = { enabled: 18, project: 3, loadFailed: 0 },
  skills = { available: 25, project: 2 },
): StartupRuntimeSnapshot {
  return {
    sessionId: "session",
    generationId: "generation",
    ownerId: "pi-runtime",
    ownerRevision: 1,
    resources: { status: "ready", value: { extensions, skills } },
    context: { status: "unavailable" },
  };
}

function updates(coverage: string, available: number): StartupOwnerSnapshot {
  return {
    type: "reply",
    schemaVersion: 1,
    sessionId: "session",
    generationId: "generation",
    ownerId: "updates",
    ownerRevision: 1,
    state: coverage === "complete" ? "ready" : "degraded",
    payload: { coverage, available },
  };
}

function integration(
  ownerId: "neovim" | "direnv" | "lsp" | "auth",
  state: StartupOwnerSnapshot["state"],
  payload?: unknown,
): StartupOwnerSnapshot {
  return {
    type: "reply",
    schemaVersion: 1,
    sessionId: "session",
    generationId: "generation",
    ownerId,
    ownerRevision: 1,
    state,
    ...(payload === undefined ? {} : { payload }),
  };
}

describe("startup header baseline", () => {
  test("renders optional startup timing and linked-worktree identity", () => {
    expect(
      renderStartupHeader(theme, 160, runtime(), 42.5, {
        branch: "topic",
        detached: false,
        root: "/worktrees/topic",
        linkedWorktree: true,
      }),
    ).toEqual([
      "π Session · 42.5ms",
      "topic · worktree /worktrees/topic",
      "18 extensions (3 project) · 25 skills (2 project)",
    ]);
  });

  test("renders detached, failed, and zero-project states truthfully", () => {
    const lines = renderStartupHeader(
      theme,
      160,
      runtime({ enabled: 4, project: 0, loadFailed: 1 }, { available: 7, project: 0 }),
      undefined,
      { detached: true, root: "/repo", linkedWorktree: false },
    );

    expect(lines).toEqual(["π Session", "detached", "4 extensions · 1 failed · 7 skills"]);
    expect(lines.join("\n")).not.toContain("(0 project)");
  });

  test("renders only published integration evidence with visible status semantics", () => {
    const lines = renderStartupHeader(theme, 160, undefined, undefined, undefined, undefined, {
      neovim: integration("neovim", "ready"),
      direnv: integration("direnv", "degraded", { problem: "blocked" }),
      lsp: integration("lsp", "collecting"),
    });
    expect(lines).toEqual(["π Session", "nvim ✓ · direnv ! · lsp ?"]);

    const observed = renderStartupHeader(theme, 160, undefined, undefined, undefined, undefined, {
      neovim: undefined,
      direnv: undefined,
      lsp: integration("lsp", "ready", { observedDocuments: 2 }),
    });
    expect(observed).toEqual(["π Session", "lsp ✓"]);
  });

  test("renders candidate states without executable claims", () => {
    const lines = renderStartupHeader(
      theme,
      200,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        formatter: { state: "ready", candidates: ["biome", "prettier"], overflow: [] },
        lsp: {
          state: "incomplete",
          candidates: ["typescript"],
          overflow: ["ancestors"],
        },
      },
    );
    expect(lines).toEqual([
      "π Session",
      "formatters: biome, prettier · lsp candidates: incomplete (ancestors): typescript",
    ]);
    expect(lines.join("\n")).not.toMatch(/installed|executable|available on path/i);
  });

  test("renders auth profiles in owner order with independent reset and expiry details", () => {
    const now = Date.now();
    const auth = integration("auth", "ready", {
      activeProfile: "work",
      profiles: [
        {
          profileLabel: "work",
          status: "reported",
          provider: "openai-codex",
          method: "oauth",
          windows: [
            { windowId: "primary", remaining: 43, allowanceResetAt: now + 60_000 },
            { windowId: "secondary", remaining: 70, allowanceResetAt: now + 120_000 },
          ],
          bankedResetCount: 0,
          bankedExpiryAt: now + 3_600_000,
          observedAt: now,
          staleAt: now + 10_000,
        },
        {
          profileLabel: "personal",
          status: "errored",
          windows: [],
          observedAt: now,
          staleAt: now + 10_000,
        },
        {
          profileLabel: "backup",
          status: "not-reported",
          windows: [],
        },
      ],
    });
    const rendered = renderStartupHeader(
      theme,
      500,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      auth,
    )[1];
    expect(rendered).toContain(
      "auth: work* [openai-codex/oauth]: primary 43% reset 1m, secondary 70% reset 2m · 0 banked",
    );
    expect(rendered).toContain("personal [next] !: no usage");
    expect(rendered).toContain("backup: not reported");
  });

  test("keeps update coverage adjacent to extensions and omits absent updates", () => {
    expect(
      renderStartupHeader(theme, 160, runtime(), undefined, undefined, updates("partial", 2))[1],
    ).toBe("18 extensions (3 project) · 2 updates (incomplete) · 25 skills (2 project)");
    expect(
      renderStartupHeader(theme, 160, runtime(), undefined, undefined, updates("complete", 0))[1],
    ).toBe("18 extensions (3 project) · 0 updates · 25 skills (2 project)");
    expect(renderStartupHeader(theme, 160, runtime())[1]).toBe(
      "18 extensions (3 project) · 25 skills (2 project)",
    );
  });

  test("omits unavailable resource and startup fields without placeholders", () => {
    const unavailable: StartupRuntimeSnapshot = {
      ...runtime(),
      resources: { status: "unavailable" },
    };
    const rendered = renderStartupHeader(theme, 160, unavailable).join("\n");

    expect(rendered).toBe("π Session");
    expect(rendered).not.toMatch(/unavailable|unknown|warning/i);
  });

  test("keeps status evidence visible while bounding every narrow line", () => {
    const now = Date.now();
    const auth = integration("auth", "degraded", {
      activeProfile: "work",
      profiles: [
        {
          profileLabel: "work",
          status: "reported",
          windows: [{ windowId: "primary", remaining: 12 }],
          observedAt: 0,
          staleAt: 1,
        },
      ],
    });
    const lines = renderStartupHeader(
      theme,
      28,
      runtime({ enabled: 4, project: 0, loadFailed: 1 }, { available: 7, project: 0 }),
      undefined,
      undefined,
      undefined,
      { neovim: undefined, direnv: undefined, lsp: integration("lsp", "collecting") },
      {
        formatter: { state: "incomplete", candidates: ["biome"], overflow: ["markers"] },
        lsp: { state: "none", candidates: [], overflow: [] },
      },
      { ...auth, staleAt: now - 1 },
    );

    expect(lines.every((line) => visibleWidth(line) <= 28)).toBe(true);
    expect(lines).toContain("lsp ?");
    expect(lines.some((line) => line.startsWith("auth stale:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("formatters: incomplete"))).toBe(true);
    expect(lines.some((line) => line.startsWith("4 extensions · 1 failed"))).toBe(true);
  });
});
