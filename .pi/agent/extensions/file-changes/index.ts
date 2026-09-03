import { readFile } from "node:fs/promises";
import {
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionFactory,
  isEditToolResult,
  isToolCallEventType,
  isWriteToolResult,
} from "@earendil-works/pi-coding-agent";
import {
  type FileBaseline,
  formatChangesStatus,
  normalizeToolPath,
  summarizeFileChange,
  type TrackedFile,
} from "./model";
import {
  type FileChangesSettings,
  loadFileChangesSettings,
  writeFileChangesSetting,
} from "./settings";
import { FileChangesWidget } from "./widget";

const BASELINE_ENTRY = "file-changes:baseline";
const CLEAR_ENTRY = "file-changes:clear";
const UNTRACK_ENTRY = "file-changes:untrack";
const UI_KEY = "file-changes";

type FileContent = string | null | undefined;
type ReadTextFile = (absolutePath: string) => Promise<FileContent>;

interface PendingSnapshot extends FileBaseline {}

interface FileChangesDependencies {
  readonly readSettings?: () => FileChangesSettings;
  readonly readTextFile?: ReadTextFile;
  readonly writeSettings?: (showFileChanges: boolean) => void;
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

function report(ctx: ExtensionContext, message: string): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, "info");
    return;
  }
  console.log(message);
}

function reportError(ctx: ExtensionContext, message: string): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, "error");
    return;
  }
  console.error(message);
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

    function clearChanges(ctx: ExtensionContext): void {
      baselines.clear();
      pendingSnapshots.clear();
      trackedFiles.clear();
      pi.appendEntry(CLEAR_ENTRY, { timestamp: Date.now() });
      updateUi(ctx);
    }

    function setShowFileChanges(value: boolean, ctx: ExtensionContext): boolean {
      try {
        (dependencies.writeSettings ?? writeFileChangesSetting)(value);
      } catch (error) {
        reportError(
          ctx,
          `Cannot update global showFileChanges setting: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return false;
      }

      showFileChanges = value;
      updateUi(ctx);
      report(ctx, value ? "Changes shown" : "Changes hidden");
      return true;
    }

    pi.registerCommand("changes", {
      description: "Toggle, show, hide, or clear file changes globally",
      getArgumentCompletions: (prefix) => {
        const input = prefix.trimStart();
        if (input.includes(" ")) return null;
        const actions = ["show", "hide", "clear"];
        const matches = actions.filter((action) => action.startsWith(input));
        return matches.length === 0 ? null : matches.map((value) => ({ value, label: value }));
      },
      handler: async (args, ctx) => {
        const action = args.trim();

        if (action === "clear") {
          const count = trackedFiles.size;
          clearChanges(ctx);
          report(ctx, `Cleared ${count} ${count === 1 ? "file" : "files"}`);
          return;
        }
        if (action === "" || action === "show" || action === "hide") {
          setShowFileChanges(action === "show" || (action === "" && !showFileChanges), ctx);
          return;
        }

        report(ctx, "Usage: /changes [show|hide|clear]");
      },
    });

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
      if (!isToolCallEventType("edit", event) && !isToolCallEventType("write", event)) return;

      const path = normalizeToolPath(ctx.cwd, event.input.path);
      const originalContent = await readText(path.absolutePath);
      if (originalContent === undefined) return;

      pendingSnapshots.set(event.toolCallId, { ...path, originalContent });
    });

    pi.on("tool_result", async (event, ctx) => {
      if (!isEditToolResult(event) && !isWriteToolResult(event)) return;

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
