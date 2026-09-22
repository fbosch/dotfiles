import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { StartupContextUsage } from "../context-usage";
import type { StartupOwnerSnapshot } from "../contracts";
import { renderStartupHeader } from "../view-model";

const theme = { fg: (_color: string, text: string) => text } as Theme;

function runtime(tokens = 18_000, contextWindow = 200_000): StartupContextUsage {
  return { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
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
  test("renders optional startup timing without workspace identity", () => {
    expect(
      renderStartupHeader(theme, 160, runtime(), 42.5, {
        branch: "topic",
        detached: false,
        root: "/worktrees/topic",
        linkedWorktree: true,
      }),
    ).toEqual(["pi", "Context: ■■■■■■■■■■■■■■ 18k / 200k (9%)", "Startup: 42.5ms"]);
  });

  test("uses one 14×14-map cell per box and rounds boundary occupancy", () => {
    expect(renderStartupHeader(theme, 160, runtime(4_000))).toContain(
      "Context: ■■■■□□□□□□□□□□ 4.0k / 200k (2%)",
    );
    expect(renderStartupHeader(theme, 160, runtime(14_286))).toContain(
      "Context: ■■■■■■■■■■■■■■ 14k / 200k (7.1%)",
    );
  });

  test("keeps the first-row slice scale instead of filling the full window", () => {
    const rendered = renderStartupHeader(theme, 160, runtime(200_000)).join("\\n");
    expect(rendered).toContain("Context: ■■■■■■■■■■■■■■ 200k / 200k (100%)");
    expect((rendered.match(/■/g) ?? []).length).toBe(14);
  });

  test("renders unknown usage without inventing a total", () => {
    const lines = renderStartupHeader(
      theme,
      160,
      { tokens: null, contextWindow: 200_000, percent: null },
      undefined,
      { detached: true, root: "/repo", linkedWorktree: false },
    );

    expect(lines).toEqual(["pi", "Context: ? / 200k"]);
    expect(lines.join("\n")).not.toMatch(/Extensions|Skills|reserve|project/);
  });

  test("renders only published integration evidence with visible status semantics", () => {
    const lines = renderStartupHeader(theme, 160, undefined, undefined, undefined, undefined, {
      neovim: integration("neovim", "ready"),
      direnv: integration("direnv", "degraded", { problem: "blocked" }),
      lsp: integration("lsp", "collecting"),
      jev: { state: "ready" },
    });
    expect(lines).toEqual(["pi", "", "nvim ✓  direnv !  lsp ?  jev ✓"]);

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
        jev: { state: "degraded" },
      },
    ).join("\n");

    expect(rendered).toContain("\u001b[32mnvim ✓");
    expect(rendered).toContain("\u001b[33mdirenv !");
    expect(rendered).toContain("\u001b[33mjev !");
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
        lsp: { state: "ready", candidates: ["tsc", "eslint"], overflow: [] },
      },
    );
    expect(lines).toEqual(["pi", "", "LSP: tsc, eslint"]);
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

  test("renders update coverage without resource totals", () => {
    expect(
      renderStartupHeader(theme, 160, runtime(), undefined, undefined, updates("partial", 2)).find(
        (line) => line.startsWith("Updates:"),
      ),
    ).toBe("Updates: 2 updates available (incomplete)");
    expect(
      renderStartupHeader(theme, 160, runtime(), undefined, undefined, updates("complete", 0)).find(
        (line) => line.startsWith("Updates:"),
      ),
    ).toBe("Updates: 0 updates available");
    expect(
      renderStartupHeader(theme, 160, runtime()).some((line) => line.startsWith("Updates:")),
    ).toBe(false);
  });

  test("omits unavailable context and startup fields without placeholders", () => {
    const rendered = renderStartupHeader(theme, 160, undefined).join("\n");

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
      runtime(),
      undefined,
      undefined,
      undefined,
      { neovim: undefined, direnv: undefined, lsp: integration("lsp", "collecting") },
      {
        lsp: { state: "none", candidates: [], overflow: [] },
      },
      { ...auth, staleAt: now - 1 },
    );

    expect(lines.every((line) => visibleWidth(line) <= 28)).toBe(true);
    expect(lines).toContain("lsp ?");
    expect(lines.some((line) => line.startsWith("auth stale"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Context:") && line.includes("18k"))).toBe(true);
  });
});
