import { basename, extname } from "node:path";
import {
  type FormatterCommand,
  matchesFormatterRule,
  type ResolvedFormatterSettings,
} from "../formatter/settings";
import type { LspLanguage, LspServerSettings, ResolvedLspSettings } from "../lsp/settings";
import { sanitizeHeaderField } from "./sanitize";

export const CANDIDATE_LIMITS = {
  ancestors: 32,
  configuredEntries: 256,
  markersPerEntry: 16,
  displayedCandidates: 64,
  repositoryFiles: 4_096,
} as const;

export type CandidateKind = "formatter" | "lsp";
export type CandidateState =
  | "trust-disabled"
  | "invalid-settings"
  | "incomplete"
  | "none"
  | "unavailable"
  | "ready";
export type CandidateOverflow =
  | "ancestors"
  | "configured-entries"
  | "files"
  | "markers"
  | "candidates";

export interface CandidateAncestor {
  readonly markers?: readonly string[];
  readonly path: string;
}

export interface CandidateInspectionInput {
  readonly ancestors: readonly CandidateAncestor[];
  readonly files?: readonly string[];
  readonly filesTruncated?: boolean;
  readonly formatter?: ResolvedFormatterSettings;
  readonly lsp?: ResolvedLspSettings;
  readonly markerReader?: (directory: string, marker: string) => boolean;
  readonly projectTrusted: boolean;
}

export interface CandidateResult {
  readonly candidates: readonly string[];
  readonly overflow: readonly CandidateOverflow[];
  readonly state: CandidateState;
}

export interface CandidateViewModel {
  readonly detail?: string;
  readonly label: string;
  readonly state: CandidateState;
}

export interface CandidateInspection {
  readonly formatter: CandidateResult;
  readonly lsp: CandidateResult;
}

interface Collector {
  readonly add: (label: string) => void;
  readonly overflow: (kind: CandidateOverflow) => void;
  readonly result: () => CandidateResult;
}

export function inspectToolCandidates(input: CandidateInspectionInput): CandidateInspection {
  if (input.projectTrusted === false) {
    return { formatter: fixedResult("trust-disabled"), lsp: fixedResult("trust-disabled") };
  }

  const ancestors = input.ancestors.slice(0, CANDIDATE_LIMITS.ancestors);
  const ancestorOverflow = input.ancestors.length > CANDIDATE_LIMITS.ancestors;
  return {
    formatter: inspectFormatters(
      input.formatter,
      input.files,
      ancestors,
      input.markerReader,
      ancestorOverflow,
      input.filesTruncated === true,
    ),
    lsp: inspectLsp(
      input.lsp,
      input.files,
      ancestors,
      input.markerReader,
      ancestorOverflow,
      input.filesTruncated === true,
    ),
  };
}

export function candidateView(kind: CandidateKind, result: CandidateResult): CandidateViewModel {
  const label = kind === "formatter" ? "formatters" : "lsp candidates";
  switch (result.state) {
    case "trust-disabled":
      return { label, state: result.state, detail: "trust disabled" };
    case "invalid-settings":
      return { label, state: result.state, detail: "invalid settings" };
    case "incomplete":
      return {
        label,
        state: result.state,
        detail: `incomplete (${result.overflow.join(", ")})${result.candidates.length === 0 ? "" : `: ${result.candidates.join(", ")}`}`,
      };
    case "none":
      return { label, state: result.state, detail: "none" };
    case "unavailable":
      return { label, state: result.state, detail: "unavailable" };
    case "ready":
      return { label, state: result.state, detail: result.candidates.join(", ") };
  }
}

export function formatCandidateView(view: CandidateViewModel): string {
  return view.detail === undefined ? view.label : `${view.label}: ${view.detail}`;
}

function inspectFormatters(
  settings: ResolvedFormatterSettings | undefined,
  files: readonly string[] | undefined,
  ancestors: readonly CandidateAncestor[],
  markerReader: CandidateInspectionInput["markerReader"],
  ancestorOverflow: boolean,
  filesTruncated: boolean,
): CandidateResult {
  if (settings === undefined) return fixedResult("unavailable");
  if (settings.warnings.length > 0) return fixedResult("invalid-settings");

  const collector = createCollector(ancestorOverflow);
  if (filesTruncated) collector.overflow("files");
  let entries = 0;
  for (const rule of settings.rules) {
    if (files !== undefined && !files.some((file) => matchesFormatterRule(rule, file))) continue;
    for (const command of rule.commands) {
      if (entries >= CANDIDATE_LIMITS.configuredEntries) {
        collector.overflow("configured-entries");
        return collector.result();
      }
      entries += 1;
      if (formatterCommandApplies(command, ancestors, markerReader, collector)) {
        collector.add(command.command);
      }
    }
  }
  return collector.result();
}

function inspectLsp(
  settings: ResolvedLspSettings | undefined,
  files: readonly string[] | undefined,
  ancestors: readonly CandidateAncestor[],
  markerReader: CandidateInspectionInput["markerReader"],
  ancestorOverflow: boolean,
  filesTruncated: boolean,
): CandidateResult {
  if (settings === undefined) return fixedResult("unavailable");
  if (settings.warnings.length > 0) return fixedResult("invalid-settings");

  const collector = createCollector(ancestorOverflow);
  if (filesTruncated) collector.overflow("files");
  for (const [index, server] of settings.servers.entries()) {
    if (index >= CANDIDATE_LIMITS.configuredEntries) {
      collector.overflow("configured-entries");
      return collector.result();
    }
    if (
      files !== undefined &&
      !server.languages.some((language) => files.some((file) => languageApplies(language, file)))
    ) {
      continue;
    }
    if (serverApplies(server, ancestors, markerReader, collector)) collector.add(server.id);
  }
  return collector.result();
}

function languageApplies(language: LspLanguage, filePath: string): boolean {
  return (
    language.extensions.includes(extname(filePath)) ||
    language.fileNames.includes(basename(filePath))
  );
}

function formatterCommandApplies(
  command: FormatterCommand,
  ancestors: readonly CandidateAncestor[],
  markerReader: CandidateInspectionInput["markerReader"],
  collector: Collector,
): boolean {
  if (command.requireRootMarker === false) return true;
  return markersMatch(command.rootMarkers, ancestors, markerReader, collector);
}

function serverApplies(
  server: LspServerSettings,
  ancestors: readonly CandidateAncestor[],
  markerReader: CandidateInspectionInput["markerReader"],
  collector: Collector,
): boolean {
  return markersMatch(server.rootMarkers, ancestors, markerReader, collector);
}

function markersMatch(
  markers: readonly string[],
  ancestors: readonly CandidateAncestor[],
  markerReader: CandidateInspectionInput["markerReader"],
  collector: Collector,
): boolean {
  const inspected = markers.slice(0, CANDIDATE_LIMITS.markersPerEntry);
  if (markers.length > CANDIDATE_LIMITS.markersPerEntry) collector.overflow("markers");
  for (const ancestor of ancestors) {
    for (const marker of inspected) {
      if (ancestor.markers?.includes(marker) || markerReader?.(ancestor.path, marker) === true)
        return true;
    }
  }
  return false;
}

function createCollector(ancestorOverflow: boolean): Collector {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const overflows = new Set<CandidateOverflow>();
  if (ancestorOverflow) overflows.add("ancestors");
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
