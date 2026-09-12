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
      "Branch: topic · Worktree: /worktrees/topic",
      "pi",
      "Extensions: 18 enabled (3 project)",
      "Skills: 25 available (2 project)",
      "Startup: 42.5ms",
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

    expect(lines).toEqual([
      "Branch: detached HEAD",
      "pi",
      "Extensions: 4 enabled, 1 failed",
      "Skills: 7 available",
    ]);
    expect(lines.join("\n")).not.toContain("(0 project)");
  });

  test("renders only published integration evidence with visible status semantics", () => {
    const lines = renderStartupHeader(theme, 160, undefined, undefined, undefined, undefined, {
      neovim: integration("neovim", "ready"),
      direnv: integration("direnv", "degraded", { problem: "blocked" }),
      lsp: integration("lsp", "collecting"),
    });
    expect(lines).toEqual(["pi", "", "nvim ✓  direnv !  lsp ?"]);

    const observed = renderStartupHeader(theme, 160, undefined, undefined, undefined, undefined, {
      neovim: undefined,
      direnv: undefined,
      lsp: integration("lsp", "ready", { observedDocuments: 2 }),
    });
    expect(observed).toEqual(["pi", "", "lsp ✓"]);
  });

  test("uses Pi theme roles for status and table evidence", () => {
    const coloredTheme = {
      fg: (color: string, text: string) =>
        `\u001b[${color === "success" ? 32 : color === "warning" ? 33 : color === "accent" ? 36 : 37}m${text}\u001b[0m`,
    } as Theme;
    const rendered = renderStartupHeader(
      coloredTheme,
      160,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        neovim: integration("neovim", "ready"),
        direnv: integration("direnv", "degraded"),
        lsp: integration("lsp", "collecting"),
      },
    ).join("\n");

    expect(rendered).toContain("\u001b[32mnvim ✓");
    expect(rendered).toContain("\u001b[33mdirenv !");
    expect(rendered).toContain("\u001b[36mpi");
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
      "pi",
      "",
      "Formatters: biome, prettier",
      "LSP: incomplete (ancestors): typescript",
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
          bankedResetCount: 2,
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
        {
          profileLabel: "default",
          status: "reported",
          provider: "openai-codex",
          method: "oauth",
          windows: [{ windowId: "primary", remaining: 99 }],
          observedAt: now,
          staleAt: now + 10_000,
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
    );
    expect(rendered.some((line) => line.startsWith("┌") && line.includes("┬"))).toBe(true);
    expect(rendered.join("\n")).toContain("work [active]");
    expect(rendered.join("\n")).toContain("43% left");
    expect(rendered.join("\n")).toContain("70% left");
    expect(rendered.join("\n")).toContain("resets");
    expect(rendered.join("\n")).toContain("personal [next] !");
    expect(rendered.join("\n")).toContain("backup");
    expect(rendered.join("\n")).not.toContain("default");
    expect(rendered.join("\n").indexOf("work")).toBeLessThan(
      rendered.join("\n").indexOf("personal"),
    );
    expect(rendered.join("\n").indexOf("personal")).toBeLessThan(
      rendered.join("\n").indexOf("backup"),
    );
    expect(rendered.join("\n")).not.toContain("Not reported");
    const allowanceTheme = {
      fg: (color: string, text: string) =>
        `\u001b[${color === "success" ? 32 : color === "warning" ? 33 : color === "error" ? 31 : 37}m${text}\u001b[0m`,
    } as Theme;
    const colored = renderStartupHeader(
      allowanceTheme,
      500,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      auth,
    ).join("\n");
    expect(colored).toContain("\u001b[33m43% left");
    expect(colored).toContain("\u001b[32m70% left");
    expect(colored).toContain("\u001b[31m2 available");
    expect(colored).toContain("\u001b[31mexpires in");
    const narrowTable = renderStartupHeader(
      theme,
      76,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      auth,
    );
    expect(narrowTable.every((line) => visibleWidth(line) <= 76)).toBe(true);
  });
  test("skips exhausted profiles when marking the next profile", () => {
    const now = Date.now();
    const auth = integration("auth", "ready", {
      activeProfile: "jpb",
      profiles: [
        {
          profileLabel: "jpb",
          status: "reported",
          provider: "openai-codex",
          windows: [{ windowId: "primary", remaining: 23 }],
          observedAt: now,
          staleAt: now + 10_000,
        },
        {
          profileLabel: "fbb",
          status: "reported",
          provider: "openai-codex",
          windows: [{ windowId: "primary", remaining: 0 }],
          observedAt: now,
          staleAt: now + 10_000,
        },
        {
          profileLabel: "ct",
          status: "reported",
          provider: "openai-codex",
          windows: [{ windowId: "primary", remaining: 86 }],
          observedAt: now,
          staleAt: now + 10_000,
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
    ).join("\n");

    expect(rendered).toContain("jpb [active]");
    expect(rendered).not.toContain("fbb [next]");
    expect(rendered).toContain("ct [next]");
  });

  test("keeps update coverage adjacent to extensions and omits absent updates", () => {
    expect(
      renderStartupHeader(theme, 160, runtime(), undefined, undefined, updates("partial", 2)).find(
        (line) => line.startsWith("Extensions:"),
      ),
    ).toBe("Extensions: 18 enabled (3 project), 2 updates available (incomplete)");
    expect(
      renderStartupHeader(theme, 160, runtime(), undefined, undefined, updates("complete", 0)).find(
        (line) => line.startsWith("Extensions:"),
      ),
    ).toBe("Extensions: 18 enabled (3 project), 0 updates available");
    expect(
      renderStartupHeader(theme, 160, runtime()).find((line) => line.startsWith("Extensions:")),
    ).toBe("Extensions: 18 enabled (3 project)");
  });

  test("omits unavailable resource and startup fields without placeholders", () => {
    const unavailable: StartupRuntimeSnapshot = {
      ...runtime(),
      resources: { status: "unavailable" },
    };
    const rendered = renderStartupHeader(theme, 160, unavailable).join("\n");

    expect(rendered).toBe("pi");
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
    expect(lines.some((line) => line.startsWith("auth stale"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Formatters: incomplete"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Extensions: 4 enabled"))).toBe(true);
    expect(lines.some((line) => line.includes("failed"))).toBe(true);
  });
});
