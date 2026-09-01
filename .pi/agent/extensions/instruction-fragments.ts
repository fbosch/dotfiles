import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";

export const INSTRUCTION_FRAGMENTS_START = "<global_instruction_fragments>";
export const INSTRUCTION_FRAGMENTS_END = "</global_instruction_fragments>";

export type InstructionFragmentApplicability = "always" | "subagent";

export interface InstructionFragmentConfig {
  path: string;
  applies: InstructionFragmentApplicability;
}

export interface LoadedInstructionFragment extends InstructionFragmentConfig {
  content: string;
}

const INSTRUCTION_FRAGMENT_CONFIG = [
  { path: "orchestration.md", applies: "subagent" },
  { path: "code-search.md", applies: "always" },
] as const satisfies readonly InstructionFragmentConfig[];

function pathEscapesDirectory(directory: string, path: string): boolean {
  const relativePath = relative(directory, path);
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

export function loadInstructionFragments(
  instructionsDirectory: string,
  fragmentConfig: readonly InstructionFragmentConfig[],
): LoadedInstructionFragment[] {
  const resolvedDirectory = realpathSync(instructionsDirectory);
  const loadedPaths = new Set<string>();

  return fragmentConfig.map((fragment) => {
    const requestedPath = resolve(resolvedDirectory, fragment.path);
    if (pathEscapesDirectory(resolvedDirectory, requestedPath)) {
      throw new Error(`Instruction fragment escapes its directory: ${fragment.path}`);
    }

    const resolvedPath = realpathSync(requestedPath);
    if (pathEscapesDirectory(resolvedDirectory, resolvedPath)) {
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

export function instructionFragmentsForTools(
  fragments: readonly LoadedInstructionFragment[],
  activeTools: readonly string[],
): string {
  const hasSubagent = activeTools.includes("subagent");
  return fragments
    .filter((fragment) => fragment.applies === "always" || hasSubagent)
    .map((fragment) => fragment.content)
    .join("\n\n");
}

export function appendInstructionFragments(systemPrompt: string, fragments: string): string {
  if (
    systemPrompt.includes(INSTRUCTION_FRAGMENTS_START) ||
    systemPrompt.includes(INSTRUCTION_FRAGMENTS_END)
  ) {
    return systemPrompt;
  }

  return `${systemPrompt}\n\n${INSTRUCTION_FRAGMENTS_START}\n${fragments}\n${INSTRUCTION_FRAGMENTS_END}`;
}

// Load one coherent snapshot per extension generation; /reload imports a fresh generation.
const GLOBAL_INSTRUCTION_FRAGMENTS = loadInstructionFragments(
  join(getAgentDir(), "instructions"),
  INSTRUCTION_FRAGMENT_CONFIG,
);

export default function instructionFragments(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    const fragments = instructionFragmentsForTools(
      GLOBAL_INSTRUCTION_FRAGMENTS,
      pi.getActiveTools(),
    );
    if (fragments.length === 0) return;

    return {
      systemPrompt: appendInstructionFragments(event.systemPrompt, fragments),
    };
  });
}
