import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const HASHLINE_PACKAGE_MARKER = "pi-hashline-edit-pro";

interface HashlineReadResult {
  readonly content?: readonly {
    readonly type?: string;
    readonly text?: unknown;
  }[];
}

interface HashlineReadTool {
  readonly execute: (
    toolCallId: string,
    params: { readonly path: string },
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    context: ExtensionContext,
  ) => Promise<HashlineReadResult>;
}

interface HashlineReadModule {
  readonly regRead: (api: ExtensionAPI) => void;
}

export type HashlineRefresh = (
  path: string,
  context: ExtensionContext,
) => Promise<string | undefined>;

function isHashlineReadTool(value: unknown): value is HashlineReadTool {
  if (value === null || typeof value !== "object") return false;
  const execute = (value as { readonly execute?: unknown }).execute;
  return typeof execute === "function";
}

function readText(result: HashlineReadResult): string | undefined {
  const text = result.content
    ?.filter(
      (entry): entry is { readonly type: "text"; readonly text: string } =>
        entry.type === "text" && typeof entry.text === "string",
    )
    .map((entry) => entry.text)
    .join("\n");
  return text === undefined || text.length === 0 ? undefined : text;
}

export function hashlinePluginPath(pi: Pick<ExtensionAPI, "getAllTools">): string | undefined {
  try {
    return pi
      .getAllTools()
      .find(
        (tool) =>
          tool.name === "read" &&
          tool.sourceInfo.source !== "builtin" &&
          tool.sourceInfo.path.includes(HASHLINE_PACKAGE_MARKER),
      )?.sourceInfo.path;
  } catch {
    return undefined;
  }
}

export function isHashlinePluginLoaded(pi: Pick<ExtensionAPI, "getAllTools">): boolean {
  return hashlinePluginPath(pi) !== undefined;
}

export async function loadHashlineRefresh(readToolPath?: string): Promise<HashlineRefresh> {
  const readModuleUrl =
    readToolPath === undefined
      ? new URL("../../npm/node_modules/pi-hashline-edit-pro/src/read.ts", import.meta.url).href
      : new URL("./src/read.ts", pathToFileURL(readToolPath)).href;
  const module = (await import(readModuleUrl)) as unknown as HashlineReadModule;
  let registeredTool: unknown;
  module.regRead({
    registerTool(tool: unknown) {
      registeredTool = tool;
    },
  } as unknown as ExtensionAPI);
  if (!isHashlineReadTool(registeredTool)) {
    throw new Error("hashline read tool was not registered");
  }

  const readTool = registeredTool;
  return async (path, context) =>
    readText(
      await readTool.execute(
        "formatter-hashline-refresh",
        { path },
        context.signal,
        undefined,
        context,
      ),
    );
}
