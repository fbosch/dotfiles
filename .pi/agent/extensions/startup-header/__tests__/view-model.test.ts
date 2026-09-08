import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
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
});
