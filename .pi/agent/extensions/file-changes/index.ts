import { readFile } from "node:fs/promises";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  type FileBaseline,
  formatChangesStatus,
  normalizeToolPath,
  summarizeFileChange,
  type TrackedFile,
} from "./model";
import { type FileChangesSettings, loadFileChangesSettings } from "./settings";
import { FileChangesWidget } from "./widget";

const BASELINE_ENTRY = "file-changes:baseline";
const CLEAR_ENTRY = "file-changes:clear";
const UNTRACK_ENTRY = "file-changes:untrack";
const UI_KEY = "file-changes";

// Hashline replaces built-in edit with these file-mutating tool names.
const FILE_MUTATION_TOOL_NAMES = new Set([
  "edit",
  "write",
  "replace",
  "insert",
  "undo_last_change",
]);

type FileContent = string | null | undefined;
type ReadTextFile = (absolutePath: string) => Promise<FileContent>;

interface PendingSnapshot extends FileBaseline {}

interface FileChangesDependencies {
  readonly readSettings?: () => FileChangesSettings;
  readonly readTextFile?: ReadTextFile;
}

async function readTextFile(absolutePath: string): Promise<FileContent> {
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return undefined;
  }
}

function entryRecord(data: unknown): Record<string, unknown> | undefined {
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : undefined;
}

function baselineFromEntry(cwd: string, data: unknown): FileBaseline | undefined {
  const record = entryRecord(data);
  if (record === undefined || typeof record.path !== "string") return undefined;
  if (record.originalContent !== null && typeof record.originalContent !== "string") {
    return undefined;
  }

  return {
    ...normalizeToolPath(cwd, record.path),
    originalContent: record.originalContent,
  };
}

function pathFromEntry(cwd: string, data: unknown): string | undefined {
  const path = entryRecord(data)?.path;
  return typeof path === "string" ? normalizeToolPath(cwd, path).path : undefined;
}


export function createFileChangesExtension(
  dependencies: FileChangesDependencies = {},
): ExtensionFactory {
  const readText = dependencies.readTextFile ?? readTextFile;

  return (pi: ExtensionAPI): void => {
    const baselines = new Map<string, FileBaseline>();
    const pendingSnapshots = new Map<string, PendingSnapshot>();
    const trackedFiles = new Map<string, TrackedFile>();
    let showFileChanges = true;

    function updateUi(ctx: ExtensionContext): void {
      if (!ctx.hasUI) return;

      ctx.ui.setStatus(UI_KEY, formatChangesStatus(trackedFiles.values()));
      if (ctx.mode !== "tui") return;
      if (!showFileChanges || trackedFiles.size === 0) {
        ctx.ui.setWidget(UI_KEY, undefined);
        return;
      }

      const changes = [...trackedFiles.values()];
      ctx.ui.setWidget(
        UI_KEY,
        (_tui, theme) => new FileChangesWidget(changes, theme, () => ctx.ui.getToolsExpanded()),
        { placement: "aboveEditor" },
      );
    }

    function clearUi(ctx: ExtensionContext): void {
      if (!ctx.hasUI) return;
      ctx.ui.setStatus(UI_KEY, undefined);
      if (ctx.mode === "tui") ctx.ui.setWidget(UI_KEY, undefined);
    }

    async function recompute(path: string): Promise<"changed" | "baseline" | "unavailable"> {
      const baseline = baselines.get(path);
      if (baseline === undefined) return "unavailable";

      const currentContent = await readText(baseline.absolutePath);
      if (currentContent === undefined) return "unavailable";

      const change = summarizeFileChange(baseline, currentContent);
      if (change === undefined) {
        trackedFiles.delete(path);
        return "baseline";
      }

      trackedFiles.set(path, change);
      return "changed";
    }

    async function rebuildFromSession(ctx: ExtensionContext): Promise<void> {
      baselines.clear();
      pendingSnapshots.clear();
      trackedFiles.clear();

      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== "custom") continue;

        if (entry.customType === CLEAR_ENTRY) {
          baselines.clear();
          continue;
        }
        if (entry.customType === BASELINE_ENTRY) {
          const baseline = baselineFromEntry(ctx.cwd, entry.data);
          if (baseline !== undefined) baselines.set(baseline.path, baseline);
          continue;
        }
        if (entry.customType === UNTRACK_ENTRY) {
          const path = pathFromEntry(ctx.cwd, entry.data);
          if (path !== undefined) baselines.delete(path);
        }
      }

      for (const path of baselines.keys()) await recompute(path);
      updateUi(ctx);
    }


    pi.on("session_start", async (_event, ctx) => {
      const settings = (dependencies.readSettings ?? loadFileChangesSettings)();
      showFileChanges = settings.showFileChanges;
      if (settings.warnings.length > 0) {
        ctx.ui.notify(`File changes settings:\n- ${settings.warnings.join("\n- ")}`, "warning");
      }
      await rebuildFromSession(ctx);
    });
    pi.on("session_tree", async (_event, ctx) => rebuildFromSession(ctx));
    pi.on("session_shutdown", (_event, ctx) => clearUi(ctx));

    pi.on("tool_call", async (event, ctx) => {
      if (!FILE_MUTATION_TOOL_NAMES.has(event.toolName)) return;

      const rawPath = entryRecord(event.input)?.path;
      if (typeof rawPath !== "string") return;
      const path = normalizeToolPath(ctx.cwd, rawPath);
      const originalContent = await readText(path.absolutePath);
      if (originalContent === undefined) return;

      pendingSnapshots.set(event.toolCallId, { ...path, originalContent });
    });

    pi.on("tool_result", async (event, ctx) => {
      if (!FILE_MUTATION_TOOL_NAMES.has(event.toolName)) return;

      const pending = pendingSnapshots.get(event.toolCallId);
      pendingSnapshots.delete(event.toolCallId);
      if (event.isError || pending === undefined) return;

      if (!baselines.has(pending.path)) {
        baselines.set(pending.path, pending);
        pi.appendEntry(BASELINE_ENTRY, {
          path: pending.path,
          originalContent: pending.originalContent,
          timestamp: Date.now(),
        });
      }

      const result = await recompute(pending.path);
      if (result === "baseline") {
        baselines.delete(pending.path);
        pi.appendEntry(UNTRACK_ENTRY, { path: pending.path, timestamp: Date.now() });
      }
      updateUi(ctx);
    });
  };
}

export default createFileChangesExtension();
