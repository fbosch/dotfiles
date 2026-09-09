import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { globalExtensionConfigPath, readJsonConfig } from "../lib/extension-config";

export const INSTRUCTION_FRAGMENTS_START = "<global_instruction_fragments>";
export const INSTRUCTION_FRAGMENTS_END = "</global_instruction_fragments>";

export interface InstructionFragmentToolCondition {
  any?: string[];
  all?: string[];
}

export interface InstructionFragmentCondition {
  tools: InstructionFragmentToolCondition;
}

export interface InstructionFragmentConfig {
  path: string;
  when?: InstructionFragmentCondition;
}

export interface LoadedInstructionFragment extends InstructionFragmentConfig {
  content: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function instructionFragmentPath(value: unknown, path: string): string {
  if (isNonEmptyString(value)) return value;
  throw new Error(`${path}: expected a non-empty string`);
}

function toolNames(value: unknown, path: string): string[] {
  if (Array.isArray(value) === false || value.length === 0) {
    throw new Error(`${path}: expected a non-empty array`);
  }
  return value.map((tool, index) => instructionFragmentPath(tool, `${path}[${index}]`));
}

function instructionFragmentCondition(value: unknown, path: string): InstructionFragmentCondition {
  if (isRecord(value) === false) throw new Error(`${path}: expected an object`);
  const unknownWhenFields = Object.keys(value).filter((field) => field !== "tools");
  if (unknownWhenFields.length > 0) {
    throw new Error(`${path}.${unknownWhenFields[0]}: unknown field`);
  }
  if (isRecord(value.tools) === false) throw new Error(`${path}.tools: expected an object`);
  const tools = value.tools;

  const unknownToolFields = Object.keys(tools).filter(
    (field) => field !== "any" && field !== "all",
  );
  if (unknownToolFields.length > 0) {
    throw new Error(`${path}.tools.${unknownToolFields[0]}: unknown field`);
  }

  const selectors = ["any", "all"].filter((field) => tools[field] !== undefined);
  if (selectors.length !== 1) {
    throw new Error(`${path}.tools: expected exactly one of any or all`);
  }
  const selector = selectors[0] as "any" | "all";
  return { tools: { [selector]: toolNames(tools[selector], `${path}.tools.${selector}`) } };
}

function parseInstructionFragmentConfig(value: unknown): InstructionFragmentConfig[] {
  if (Array.isArray(value) === false) {
    throw new Error("instruction-fragments config: expected an array");
  }

  return value.map((entry, index) => {
    const path = `instruction-fragments config[${index}]`;
    if (typeof entry === "string") {
      return { path: instructionFragmentPath(entry, path) };
    }
    if (isRecord(entry) === false) {
      throw new Error(`${path}: expected a path string or object`);
    }

    const unknownFields = Object.keys(entry).filter(
      (field) => field !== "path" && field !== "when",
    );
    if (unknownFields.length > 0) {
      throw new Error(`${path}.${unknownFields[0]}: unknown field`);
    }

    const fragmentPath = instructionFragmentPath(entry.path, `${path}.path`);
    const when =
      entry.when === undefined
        ? undefined
        : instructionFragmentCondition(entry.when, `${path}.when`);

    return { path: fragmentPath, ...(when === undefined ? {} : { when }) };
  });
}

function discoverInstructionFragmentConfig(
  directory: string,
  basePath = "",
): InstructionFragmentConfig[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = basePath === "" ? entry.name : join(basePath, entry.name);
      const entryPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        return discoverInstructionFragmentConfig(entryPath, path);
      }
      if (entry.isFile() === false || entry.name.endsWith(".md") === false) return [];
      return [{ path }];
    });
}

function pathEscapesDirectory(directory: string, path: string): boolean {
  const relativePath = relative(directory, path);
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

function loadInstructionFragmentsFromPaths(
  instructionsDirectory: string,
  fragmentConfig: readonly InstructionFragmentConfig[],
  allowExternalPaths: boolean,
): LoadedInstructionFragment[] {
  const resolvedDirectory = realpathSync(instructionsDirectory);
  const loadedPaths = new Set<string>();

  return fragmentConfig.map((fragment) => {
    const requestedPath = resolve(resolvedDirectory, fragment.path);
    if (!allowExternalPaths && pathEscapesDirectory(resolvedDirectory, requestedPath)) {
      throw new Error(`Instruction fragment escapes its directory: ${fragment.path}`);
    }

    const resolvedPath = realpathSync(requestedPath);
    if (!allowExternalPaths && pathEscapesDirectory(resolvedDirectory, resolvedPath)) {
      throw new Error(`Instruction fragment symlink escapes its directory: ${fragment.path}`);
    }

    if (loadedPaths.has(resolvedPath)) {
      throw new Error(`Duplicate instruction fragment: ${fragment.path}`);
    }
    loadedPaths.add(resolvedPath);

    if (statSync(resolvedPath).isFile() === false) {
      throw new Error(`Instruction fragment must be a regular file: ${fragment.path}`);
    }

    const content = readFileSync(resolvedPath, "utf8").trim();
    if (content.length === 0) {
      throw new Error(`Instruction fragment is empty: ${fragment.path}`);
    }

    if (
      content.includes(INSTRUCTION_FRAGMENTS_START) ||
      content.includes(INSTRUCTION_FRAGMENTS_END)
    ) {
      throw new Error(`Instruction fragment contains a reserved marker: ${fragment.path}`);
    }

    return { ...fragment, content };
  });
}

export function loadInstructionFragments(
  instructionsDirectory: string,
  fragmentConfig: readonly InstructionFragmentConfig[],
): LoadedInstructionFragment[] {
  return loadInstructionFragmentsFromPaths(instructionsDirectory, fragmentConfig, false);
}

export function loadConfiguredInstructionFragments(
  instructionsDirectory: string,
  fragmentConfig: readonly InstructionFragmentConfig[],
): LoadedInstructionFragment[] {
  return loadInstructionFragmentsFromPaths(instructionsDirectory, fragmentConfig, true);
}

export function loadGlobalInstructionFragments(
  agentDirectory = getAgentDir(),
): LoadedInstructionFragment[] {
  const instructionsDirectory = join(agentDirectory, "instructions");
  const configuredFragments = readJsonConfig(
    globalExtensionConfigPath("instruction-fragments", agentDirectory),
  );
  const fragmentConfig =
    configuredFragments === undefined
      ? discoverInstructionFragmentConfig(instructionsDirectory)
      : parseInstructionFragmentConfig(configuredFragments);

  return loadConfiguredInstructionFragments(instructionsDirectory, fragmentConfig);
}

function matchesActiveTools(
  fragment: LoadedInstructionFragment,
  activeTools: ReadonlySet<string>,
): boolean {
  const tools = fragment.when?.tools;
  if (tools === undefined) return true;
  if (tools.any !== undefined) return tools.any.some((tool) => activeTools.has(tool));
  return tools.all?.every((tool) => activeTools.has(tool)) ?? false;
}

export function instructionFragmentsForTools(
  fragments: readonly LoadedInstructionFragment[],
  activeTools: readonly string[],
): string {
  const activeToolSet = new Set(activeTools);
  return fragments
    .filter((fragment) => matchesActiveTools(fragment, activeToolSet))
    .map((fragment) => fragment.content)
    .join("\n\n");
}

export function appendInstructionFragments(systemPrompt: string, fragments: string): string {
  const markedStart = systemPrompt.indexOf(INSTRUCTION_FRAGMENTS_START);
  const markedEnd = systemPrompt.indexOf(INSTRUCTION_FRAGMENTS_END);
  const marked = markedStart !== -1 || markedEnd !== -1;
  const block =
    fragments.length === 0
      ? ""
      : `${INSTRUCTION_FRAGMENTS_START}\n${fragments}\n${INSTRUCTION_FRAGMENTS_END}`;

  if (!marked) {
    return block.length === 0 ? systemPrompt : `${systemPrompt}\n\n${block}`;
  }
  if (markedStart === -1 || markedEnd === -1 || markedEnd < markedStart) {
    return systemPrompt;
  }
  const before = systemPrompt.slice(0, markedStart).trimEnd();
  const after = systemPrompt.slice(markedEnd + INSTRUCTION_FRAGMENTS_END.length).trimStart();
  return [before, block, after].filter((part) => part.length > 0).join("\n\n");
}

// Load one coherent snapshot per extension generation; /reload imports a fresh generation.
const GLOBAL_INSTRUCTION_FRAGMENTS = loadGlobalInstructionFragments();

export default function instructionFragments(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    const fragments = instructionFragmentsForTools(
      GLOBAL_INSTRUCTION_FRAGMENTS,
      pi.getActiveTools(),
    );
    const systemPrompt = appendInstructionFragments(event.systemPrompt, fragments);
    if (systemPrompt === event.systemPrompt) return;

    return {
      systemPrompt,
    };
  });
}
