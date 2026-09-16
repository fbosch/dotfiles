import { matchesPiLensServer, type PiLensServerCandidate } from "./pi-lens-config";
import { sanitizeHeaderField } from "./sanitize";

export const CANDIDATE_LIMITS = {
  configuredEntries: 256,
  displayedCandidates: 64,
  repositoryFiles: 4_096,
} as const;

export type CandidateState = "trust-disabled" | "incomplete" | "none" | "unavailable" | "ready";
export type CandidateOverflow = "configured-entries" | "files" | "candidates";

export interface CandidateInspectionInput {
  readonly files?: readonly string[];
  readonly filesTruncated?: boolean;
  readonly lspServers?: readonly PiLensServerCandidate[];
  readonly projectTrusted: boolean;
}

export interface CandidateResult {
  readonly candidates: readonly string[];
  readonly overflow: readonly CandidateOverflow[];
  readonly state: CandidateState;
}

export interface CandidateInspection {
  readonly lsp: CandidateResult;
}

interface Collector {
  readonly add: (label: string) => void;
  readonly overflow: (kind: CandidateOverflow) => void;
  readonly result: () => CandidateResult;
}

export function inspectToolCandidates(input: CandidateInspectionInput): CandidateInspection {
  if (input.projectTrusted === false) return { lsp: fixedResult("trust-disabled") };

  return {
    lsp: inspectLspServers(input.lspServers, input.files, input.filesTruncated === true),
  };
}

export function formatCandidateView(result: CandidateResult): string {
  switch (result.state) {
    case "trust-disabled":
      return "lsp: trust disabled";
    case "incomplete":
      return `lsp: incomplete (${result.overflow.join(", ")})${result.candidates.length === 0 ? "" : `: ${result.candidates.join(", ")}`}`;
    case "none":
      return "lsp: none";
    case "unavailable":
      return "lsp: unavailable";
    case "ready":
      return `lsp: ${result.candidates.join(", ")}`;
  }
}

function inspectLspServers(
  servers: readonly PiLensServerCandidate[] | undefined,
  files: readonly string[] | undefined,
  filesTruncated: boolean,
): CandidateResult {
  if (servers === undefined) return fixedResult("unavailable");
  const collector = createCollector();
  if (filesTruncated) collector.overflow("files");
  for (const [index, server] of servers.entries()) {
    if (index >= CANDIDATE_LIMITS.configuredEntries) {
      collector.overflow("configured-entries");
      break;
    }
    if (files === undefined || files.some((file) => matchesPiLensServer(server, file))) {
      collector.add(server.id);
    }
  }
  return collector.result();
}

function createCollector(): Collector {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const overflows = new Set<CandidateOverflow>();
  return {
    add(label) {
      const sanitized = sanitizeHeaderField(label, 48);
      if (sanitized.length === 0 || seen.has(sanitized)) return;
      if (candidates.length >= CANDIDATE_LIMITS.displayedCandidates) {
        overflows.add("candidates");
        return;
      }
      seen.add(sanitized);
      candidates.push(sanitized);
    },
    overflow(kind) {
      overflows.add(kind);
    },
    result() {
      const overflow = [...overflows];
      return {
        candidates: Object.freeze(candidates),
        overflow: Object.freeze(overflow),
        state: overflow.length > 0 ? "incomplete" : candidates.length === 0 ? "none" : "ready",
      };
    },
  };
}

function fixedResult(
  state: Exclude<CandidateState, "incomplete" | "none" | "ready">,
): CandidateResult {
  return { candidates: Object.freeze([]), overflow: Object.freeze([]), state };
}
