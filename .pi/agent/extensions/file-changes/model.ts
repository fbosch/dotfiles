import { relative, resolve } from "node:path";
import { generateUnifiedPatch } from "@earendil-works/pi-coding-agent";

export interface FileBaseline {
  readonly path: string;
  readonly absolutePath: string;
  readonly originalContent: string | null;
}

export interface TrackedFile {
  readonly path: string;
  readonly kind: "added" | "modified";
  readonly added: number;
  readonly removed: number;
}

export function normalizeToolPath(
  cwd: string,
  rawPath: string,
): Pick<FileBaseline, "path" | "absolutePath"> {
  const path = rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
  const absolutePath = resolve(cwd, path);
  return {
    path: relative(cwd, absolutePath) || ".",
    absolutePath,
  };
}

export function countPatchLines(patch: string): Pick<TrackedFile, "added" | "removed"> {
  let added = 0;
  let removed = 0;

  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) added += 1;
    if (line.startsWith("-")) removed += 1;
  }

  return { added, removed };
}

export function summarizeFileChange(
  baseline: FileBaseline,
  currentContent: string | null,
): TrackedFile | undefined {
  if (baseline.originalContent === null && currentContent === null) return undefined;
  if (baseline.originalContent !== null && currentContent === baseline.originalContent) {
    return undefined;
  }

  const patch = generateUnifiedPatch(
    baseline.path,
    baseline.originalContent ?? "",
    currentContent ?? "",
    0,
  );

  return {
    path: baseline.path,
    kind: baseline.originalContent === null ? "added" : "modified",
    ...countPatchLines(patch),
  };
}

export function formatChangesStatus(changes: Iterable<TrackedFile>): string | undefined {
  let files = 0;
  let added = 0;
  let removed = 0;

  for (const change of changes) {
    files += 1;
    added += change.added;
    removed += change.removed;
  }

  if (files === 0) return undefined;

  return [
    `${files} ${files === 1 ? "file" : "files"}`,
    added > 0 ? `+${added}` : undefined,
    removed > 0 ? `-${removed}` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" ");
}
