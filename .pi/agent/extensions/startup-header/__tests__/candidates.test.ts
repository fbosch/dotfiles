import { describe, expect, test } from "bun:test";
import {
  CANDIDATE_LIMITS,
  type CandidateInspectionInput,
  type CandidateResult,
  formatCandidateView,
  inspectToolCandidates,
} from "../candidates";
import { matchesPiLensServer, type PiLensServerCandidate } from "../pi-lens-config";

const server = (id: string, extensions: readonly string[] = [".ts"]): PiLensServerCandidate => ({
  id,
  extensions,
});
const input = (overrides: Partial<CandidateInspectionInput> = {}): CandidateInspectionInput => ({
  projectTrusted: true,
  ...overrides,
});

describe("startup header LSP candidates", () => {
  test("uses matching file mappings", () => {
    const result = inspectToolCandidates(
      input({
        files: ["src/index.ts"],
        lspServers: [server("tsc")],
      }),
    );

    expect(result.lsp).toMatchObject({ state: "ready", candidates: ["tsc"] });
  });

  test("excludes servers without compatible repository files", () => {
    const result = inspectToolCandidates(
      input({
        files: ["README.md"],
        lspServers: [server("tsc")],
      }),
    );

    expect(result.lsp).toMatchObject({ state: "none", candidates: [] });
  });

  test("keeps configured order without duplicates", () => {
    const result = inspectToolCandidates(
      input({ lspServers: [server("primary"), server("fallback"), server("primary")] }),
    );

    expect(result.lsp).toMatchObject({ state: "ready", candidates: ["primary", "fallback"] });
  });

  test("reports collection caps with retained candidate data", () => {
    const servers = Array.from({ length: CANDIDATE_LIMITS.configuredEntries + 1 }, (_, index) =>
      server(`lsp-${index}`),
    );
    const result = inspectToolCandidates(input({ lspServers: servers }));

    expect(result.lsp.state).toBe("incomplete");
    expect(result.lsp.overflow).toContain("configured-entries");
    expect(result.lsp.overflow).toContain("candidates");
    expect(result.lsp.candidates).toHaveLength(CANDIDATE_LIMITS.displayedCandidates);
  });

  test("distinguishes candidate states", () => {
    const states: readonly [CandidateResult, string][] = [
      [{ state: "trust-disabled", candidates: [], overflow: [] }, "lsp: trust disabled"],
      [{ state: "none", candidates: [], overflow: [] }, "lsp: none"],
      [{ state: "unavailable", candidates: [], overflow: [] }, "lsp: unavailable"],
      [{ state: "ready", candidates: ["tsc"], overflow: [] }, "lsp: tsc"],
    ];

    for (const [result, expected] of states) expect(formatCandidateView(result)).toBe(expected);
  });

  test("matches configured file extensions", () => {
    expect(matchesPiLensServer(server("tsc", [".mts"]), "src/index.mts")).toBe(true);
    expect(matchesPiLensServer(server("tsc", [".mts"]), "src/index.ts")).toBe(false);
  });
});
