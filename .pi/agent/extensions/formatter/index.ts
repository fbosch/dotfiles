import {
  type ExtensionContext,
  type ExtensionFactory,
  getAgentDir,
  isEditToolResult,
  isWriteToolResult,
  SettingsManager,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { type CommandAvailability, formatFile } from "./format-file";
import { type ResolvedFormatterSettings, resolveFormatterSettings } from "./settings";

type SettingsLoader = (context: ExtensionContext) => ResolvedFormatterSettings;

interface FormatterExtensionDependencies {
  readonly commandAvailable?: CommandAvailability;
  readonly readSettings?: SettingsLoader;
}

function loadSettings(context: ExtensionContext): ResolvedFormatterSettings {
  const manager = SettingsManager.create(context.cwd, getAgentDir(), {
    projectTrusted: context.isProjectTrusted(),
  });
  return resolveFormatterSettings(manager.getGlobalSettings(), manager.getProjectSettings());
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
    const fileQueues = new Map<string, Promise<void>>();

    function serialize<T>(path: string, operation: () => Promise<T>): Promise<T> {
      const previous = fileQueues.get(path) ?? Promise.resolve();
      const current = previous.catch(() => undefined).then(operation);
      const settled = current.then(
        () => undefined,
        () => undefined,
      );
      fileQueues.set(path, settled);
      return current.finally(() => {
        if (fileQueues.get(path) === settled) fileQueues.delete(path);
      });
    }

    pi.on("session_start", (_event, context) => {
      settings = (dependencies.readSettings ?? loadSettings)(context);
      if (settings.warnings.length > 0) {
        context.ui.notify(`Formatter settings:\n- ${settings.warnings.join("\n- ")}`, "warning");
      }
    });

    pi.on("tool_result", async (event, context) => {
      const path = mutationPath(event);
      const currentSettings = settings;
      if (path === undefined || currentSettings === undefined) return undefined;

      const warnings = await serialize(path, () =>
        formatFile({
          cwd: context.cwd,
          execute: (command, args, options) => pi.exec(command, args, options),
          filePath: path,
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
