import { describe, expect, spyOn, test } from "bun:test";
import type { FormatterCommand, ResolvedFormatterSettings } from "../../formatter/settings";
import type { LspServerSettings, ResolvedLspSettings } from "../../lsp/settings";
import { resolveMarkerTarget } from "../candidate-adapter";
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
const server = (id: string, rootMarkers = [".git"]): LspServerSettings => ({
  id,
  command: `${id}-language-server`,
  args: [],
  rootMarkers,
  languages: [{ languageId: "typescript", extensions: [".ts"], fileNames: [] }],
});
const lsp = (servers: readonly LspServerSettings[]): ResolvedLspSettings => ({
  servers,
  timeouts: { diagnosticsMs: 5_000, requestMs: 10_000, shutdownMs: 2_000, startupMs: 10_000 },
  warnings: [],
});
const input = (overrides: Partial<CandidateInspectionInput> = {}): CandidateInspectionInput => ({
  projectTrusted: true,
  ancestors: [
    { path: "/repo/src", markers: [] },
    { path: "/repo", markers: [".git"] },
  ],
  ...overrides,
});

describe("startup header tool candidates", () => {
  test("uses matching configured file/language mappings and root markers", () => {
    const result = inspectToolCandidates(
      input({
        formatter: formatter([command("biome", true, ["biome.json"])]),
        lsp: lsp([server("typescript", ["package.json"])]),
        ancestors: [
          { path: "/repo/src", markers: ["biome.json"] },
          { path: "/repo", markers: ["package.json"] },
        ],
      }),
    );
    expect(result.formatter).toMatchObject({ state: "ready", candidates: ["biome"] });
    expect(result.lsp).toMatchObject({ state: "ready", candidates: ["typescript"] });
  });

  test("keeps unconditional formatter commands and first-available fallback order without duplicates", () => {
    const result = inspectToolCandidates(
      input({
        formatter: formatter([command("primary"), command("fallback"), command("primary")]),
        lsp: lsp([]),
      }),
    );
    expect(result.formatter).toMatchObject({ state: "ready", candidates: ["primary", "fallback"] });
  });

  test("uses only the supplied chain and bounded direct marker reader", () => {
    const markerReader = spyOn(
      { exists: (_directory: string, _marker: string) => false },
      "exists",
    );
    const result = inspectToolCandidates(
      input({
        lsp: lsp([server("typescript", ["missing"])]),
        markerReader: (directory, marker) => markerReader(directory, marker),
      }),
    );
    expect(result.lsp.state).toBe("none");
    expect(markerReader).toHaveBeenCalledTimes(2);
    expect(markerReader).toHaveBeenCalledWith("/repo/src", "missing");
    expect(markerReader).toHaveBeenCalledWith("/repo", "missing");
  });

  test("reports every collection cap with retained candidate data", () => {
    const ancestorResult = inspectToolCandidates(
      input({
        formatter: formatter([command("biome")]),
        ancestors: Array.from({ length: CANDIDATE_LIMITS.ancestors + 1 }, (_, index) => ({
          path: `/repo/${index}`,
          markers: [],
        })),
      }),
    );
    expect(ancestorResult.formatter).toMatchObject({
      state: "incomplete",
      candidates: ["biome"],
      overflow: ["ancestors"],
    });

    const entries = Array.from({ length: CANDIDATE_LIMITS.configuredEntries + 1 }, (_, index) =>
      command(`formatter-${index}`),
    );
    const entryResult = inspectToolCandidates(input({ formatter: formatter(entries) }));
    expect(entryResult.formatter.state).toBe("incomplete");
    expect(entryResult.formatter.overflow).toContain("configured-entries");
    expect(entryResult.formatter.overflow).toContain("candidates");
    expect(entryResult.formatter.candidates).toHaveLength(CANDIDATE_LIMITS.displayedCandidates);

    const markerResult = inspectToolCandidates(
      input({
        lsp: lsp([
          server(
            "typescript",
            Array.from({ length: 17 }, (_, index) => `marker-${index}`),
          ),
        ]),
      }),
    );
    expect(markerResult.lsp).toMatchObject({ state: "incomplete", overflow: ["markers"] });

    const candidateResult = inspectToolCandidates(
      input({
        lsp: lsp(
          Array.from({ length: CANDIDATE_LIMITS.displayedCandidates + 1 }, (_, index) =>
            server(`server-${index}`),
          ),
        ),
      }),
    );
    expect(candidateResult.lsp).toMatchObject({ state: "incomplete", overflow: ["candidates"] });
    expect(candidateResult.lsp.candidates).toHaveLength(CANDIDATE_LIMITS.displayedCandidates);
  });

  test("distinguishes every candidate state and keeps overflow visible", () => {
    const states: readonly [CandidateResult, string][] = [
      [{ state: "trust-disabled", candidates: [], overflow: [] }, "formatters: trust disabled"],
      [{ state: "invalid-settings", candidates: [], overflow: [] }, "formatters: invalid settings"],
      [
        { state: "incomplete", candidates: ["biome"], overflow: ["markers"] },
        "formatters: incomplete (markers): biome",
      ],
      [{ state: "none", candidates: [], overflow: [] }, "formatters: none"],
      [{ state: "unavailable", candidates: [], overflow: [] }, "formatters: unavailable"],
      [{ state: "ready", candidates: ["biome"], overflow: [] }, "formatters: biome"],
    ];
    for (const [result, expected] of states)
      expect(formatCandidateView(candidateView("formatter", result))).toBe(expected);
    expect(inspectToolCandidates(input({ projectTrusted: false })).formatter.state).toBe(
      "trust-disabled",
    );
    expect(
      inspectToolCandidates(input({ formatter: { ...formatter([]), warnings: ["invalid"] } }))
        .formatter.state,
    ).toBe("invalid-settings");
    expect(inspectToolCandidates(input({ formatter: formatter([]) })).formatter.state).toBe("none");
    expect(inspectToolCandidates(input()).formatter.state).toBe("unavailable");
  });

  test("never executes or spawns candidate commands", () => {
    const spawn = spyOn(Bun, "spawn");
    inspectToolCandidates(
      input({ formatter: formatter([command("biome")]), lsp: lsp([server("typescript")]) }),
    );
    expect(spawn).not.toHaveBeenCalled();
    spawn.mockRestore();
  });

  test("rejects marker paths outside the inspected ancestor", () => {
    expect(resolveMarkerTarget("/repo/project", ".toolrc")).toBe("/repo/project/.toolrc");
    expect(resolveMarkerTarget("/repo/project", "config/.toolrc")).toBe(
      "/repo/project/config/.toolrc",
    );
    expect(resolveMarkerTarget("/repo/project", "../.toolrc")).toBeUndefined();
    expect(resolveMarkerTarget("/repo/project", "/tmp/.toolrc")).toBeUndefined();
  });
});
