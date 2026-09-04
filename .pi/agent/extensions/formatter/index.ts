import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type ExtensionContext,
  type ExtensionFactory,
  getAgentDir,
  isEditToolResult,
  isWriteToolResult,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { loadExtensionConfigLayers } from "../../lib/extension-config";
import type { CommandAvailability, FormatterExecutor } from "./format-file";
import {
  DEFAULT_FORMATTER_TIMEOUT_MS,
  matchesFormatterRule,
  type ResolvedFormatterSettings,
  resolveFormatterSettings,
} from "./settings";

type SettingsLoader = (context: ExtensionContext) => ResolvedFormatterSettings;

interface FormatterRuntime {
  readonly execute: FormatterExecutor;
  readonly formatFile: typeof import("./format-file").formatFile;
}

type FormatterRuntimeLoader = () => Promise<FormatterRuntime>;

interface FormatterExtensionDependencies {
  readonly commandAvailable?: CommandAvailability;
  readonly execute?: FormatterExecutor;
  readonly loadRuntime?: FormatterRuntimeLoader;
  readonly readSettings?: SettingsLoader;
}

async function loadFormatterRuntime(): Promise<FormatterRuntime> {
  const [{ formatFile }, { runFormatterCommand }] = await Promise.all([
    import("./format-file"),
    import("./command-runner"),
  ]);
  return { execute: runFormatterCommand, formatFile };
}

export function loadFormatterSettings(
  context: ExtensionContext,
  agentDirectory = getAgentDir(),
): ResolvedFormatterSettings {
  if (context.isProjectTrusted() === false) {
    return { rules: [], timeoutMs: DEFAULT_FORMATTER_TIMEOUT_MS, warnings: [] };
  }
  try {
    const config = loadExtensionConfigLayers("formatter", context, agentDirectory);
    return resolveFormatterSettings(config.global, config.project);
  } catch (error) {
    return {
      rules: [],
      timeoutMs: DEFAULT_FORMATTER_TIMEOUT_MS,
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function mutationPath(event: ToolResultEvent): string | undefined {
  if (event.isError) return undefined;
  if (isEditToolResult(event) === false && isWriteToolResult(event) === false) return undefined;
  const path = event.input.path;
  if (typeof path === "string") return path;
  return undefined;
}

export function createFormatterExtension(
  dependencies: FormatterExtensionDependencies = {},
): ExtensionFactory {
  return (pi) => {
    let settings: ResolvedFormatterSettings | undefined;
    let runtimePromise: Promise<FormatterRuntime> | undefined;
    const fileQueues = new Map<string, Promise<void>>();
    const runtimeLoader = dependencies.loadRuntime ?? loadFormatterRuntime;

    function runtime(): Promise<FormatterRuntime> {
      if (runtimePromise !== undefined) return runtimePromise;
      const loaded = runtimeLoader().then((loadedRuntime) => ({
        ...loadedRuntime,
        ...(dependencies.execute === undefined ? {} : { execute: dependencies.execute }),
      }));
      runtimePromise = loaded;
      void loaded.catch(() => {
        if (runtimePromise === loaded) runtimePromise = undefined;
      });
      return loaded;
    }

    function serialize<T>(keys: readonly string[], operation: () => Promise<T>): Promise<T> {
      const uniqueKeys = [...new Set(keys)];
      const previous = uniqueKeys.flatMap((key) => {
        const queued = fileQueues.get(key);
        return queued === undefined ? [] : [queued];
      });
      const current = Promise.all(previous.map((queued) => queued.catch(() => undefined))).then(
        operation,
      );
      const settled = current.then(
        () => undefined,
        () => undefined,
      );
      for (const key of uniqueKeys) fileQueues.set(key, settled);
      return current.finally(() => {
        for (const key of uniqueKeys) {
          if (fileQueues.get(key) === settled) fileQueues.delete(key);
        }
      });
    }

    pi.on("session_start", (_event, context) => {
      settings = (dependencies.readSettings ?? loadFormatterSettings)(context);
      if (settings.warnings.length > 0) {
        context.ui.notify(`Formatter settings:\n- ${settings.warnings.join("\n- ")}`, "warning");
      }
    });

    pi.on("tool_result", async (event, context) => {
      const path = mutationPath(event);
      const currentSettings = settings;
      if (path === undefined || currentSettings === undefined) return undefined;
      const filePath = resolve(context.cwd, path);
      if (currentSettings.rules.some((rule) => matchesFormatterRule(rule, filePath)) === false) {
        return undefined;
      }
      const formatterRuntime = await runtime();
      const queuePath = await realpath(filePath).catch(() => filePath);
      const identity = await stat(filePath)
        .then(({ dev, ino }) => `inode:${dev}:${ino}`)
        .catch(() => undefined);

      const warnings = await serialize(
        identity === undefined ? [`path:${queuePath}`] : [`path:${queuePath}`, identity],
        () =>
          formatterRuntime.formatFile({
            cwd: context.cwd,
            // Pi 0.84.4's executor can leave timed-out children alive and buffer unbounded output.
            execute: formatterRuntime.execute,
            filePath,
            settings: currentSettings,
            ...(dependencies.commandAvailable === undefined
              ? {}
              : { commandAvailable: dependencies.commandAvailable }),
            ...(context.signal === undefined ? {} : { signal: context.signal }),
          }),
      );
      if (warnings.length === 0) return undefined;
      return {
        content: [...event.content, { type: "text", text: warnings.join("\n") }],
      };
    });
  };
}

export default createFormatterExtension();
