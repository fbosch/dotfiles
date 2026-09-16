import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FormatterCommand, ResolvedFormatterSettings } from "../../formatter/settings";
import { markerExistsWithinDirectory, resolveMarkerTarget } from "../candidate-adapter";
import {
  CANDIDATE_LIMITS,
  type CandidateInspectionInput,
  type CandidateResult,
  candidateView,
  formatCandidateView,
  inspectToolCandidates,
} from "../candidates";

const formatter = (commands: readonly FormatterCommand[]): ResolvedFormatterSettings => ({
  rules: [{ id: "source", extensions: [".ts"], fileNames: [], mode: "first_available", commands }],
  timeoutMs: 30_000,
  warnings: [],
});
const command = (
  name: string,
  requireRootMarker = false,
  rootMarkers: readonly string[] = [],
): FormatterCommand => ({ command: name, args: ["$FILE"], requireRootMarker, rootMarkers });
const input = (overrides: Partial<CandidateInspectionInput> = {}): CandidateInspectionInput => ({
  projectTrusted: true,
  ancestors: [
    { path: "/repo/src", markers: [] },
    { path: "/repo", markers: [".git"] },
  ],
  ...overrides,
});

describe("startup header formatter candidates", () => {
  test("uses matching file mappings and root markers", () => {
    const result = inspectToolCandidates(
      input({
        formatter: formatter([command("biome", true, ["biome.json"])]),
        files: ["src/index.ts"],
        ancestors: [{ path: "/repo", markers: ["biome.json"] }],
      }),
    );
    expect(result.formatter).toMatchObject({ state: "ready", candidates: ["biome"] });
  });

  test("excludes marker-matched tools without compatible repository files", () => {
    const result = inspectToolCandidates(
      input({
        files: ["README.md"],
        formatter: formatter([command("biome", true, ["package.json"])]),
        ancestors: [{ path: "/repo", markers: ["package.json"] }],
      }),
    );
    expect(result.formatter).toMatchObject({ state: "none", candidates: [] });
  });

  test("keeps first-available fallback order without duplicates", () => {
    const result = inspectToolCandidates(
      input({
        formatter: formatter([command("primary"), command("fallback"), command("primary")]),
      }),
    );
    expect(result.formatter).toMatchObject({ state: "ready", candidates: ["primary", "fallback"] });
  });

  test("reports collection caps with retained candidate data", () => {
    const entries = Array.from({ length: CANDIDATE_LIMITS.configuredEntries + 1 }, (_, index) =>
      command(`formatter-${index}`),
    );
    const result = inspectToolCandidates(input({ formatter: formatter(entries) }));
    expect(result.formatter.state).toBe("incomplete");
    expect(result.formatter.overflow).toContain("configured-entries");
    expect(result.formatter.overflow).toContain("candidates");
    expect(result.formatter.candidates).toHaveLength(CANDIDATE_LIMITS.displayedCandidates);
  });

  test("distinguishes candidate states", () => {
    const states: readonly [CandidateResult, string][] = [
      [{ state: "trust-disabled", candidates: [], overflow: [] }, "formatters: trust disabled"],
      [{ state: "invalid-settings", candidates: [], overflow: [] }, "formatters: invalid settings"],
      [{ state: "none", candidates: [], overflow: [] }, "formatters: none"],
      [{ state: "unavailable", candidates: [], overflow: [] }, "formatters: unavailable"],
      [{ state: "ready", candidates: ["biome"], overflow: [] }, "formatters: biome"],
    ];
    for (const [result, expected] of states)
      expect(formatCandidateView(candidateView("formatter", result))).toBe(expected);
  });

  test("never executes candidate commands", () => {
    const spawn = spyOn(Bun, "spawn");
    inspectToolCandidates(input({ formatter: formatter([command("biome")]) }));
    expect(spawn).not.toHaveBeenCalled();
    spawn.mockRestore();
  });

  test("rejects marker paths outside the inspected ancestor", () => {
    expect(resolveMarkerTarget("/repo/project", ".toolrc")).toBe("/repo/project/.toolrc");
    expect(resolveMarkerTarget("/repo/project", "../.toolrc")).toBeUndefined();
    expect(resolveMarkerTarget("/repo/project", "/tmp/.toolrc")).toBeUndefined();

    const base = mkdtempSync(join(tmpdir(), "startup-candidates-"));
    try {
      const root = join(base, "root");
      const outside = join(base, "outside");
      mkdirSync(root);
      mkdirSync(outside);
      writeFileSync(join(outside, ".toolrc"), "");
      symlinkSync(outside, join(root, "config"));
      expect(markerExistsWithinDirectory(root, "config/.toolrc")).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
