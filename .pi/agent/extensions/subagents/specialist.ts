import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { match, P } from "ts-pattern";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];
const PARENT_TOOLS = [
  "subagent",
  "subagent_result",
  "subagent_control",
  "get_subagent_result",
  "steer_subagent",
];
const SHARED_TOOLS = ["codemode"] as const;

export interface CapabilityBundle {
  readonly extensions: readonly string[];
  readonly mcpServers?: readonly string[];
}

export interface SpecialistCatalog {
  readonly baseline: CapabilityBundle;
  readonly bundles: ReadonlyMap<string, CapabilityBundle>;
  readonly skills: ReadonlyMap<string, string>;
  readonly availableModels: ReadonlySet<string>;
}

export interface AssignmentOverrides {
  readonly model?: string;
  readonly thinking?: ThinkingLevel;
  readonly maxTurns?: number;
  readonly hardMaxTurns?: number;
}

export interface ResolvedSpecialist {
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly model: string;
  readonly thinking?: ThinkingLevel;
  readonly maxTurns: number;
  readonly hardMaxTurns?: number;
  readonly tools: readonly string[];
  readonly excludeTools: readonly string[];
  readonly extensions: readonly string[];
  readonly skills: readonly Readonly<{ name: string; path: string }>[];
  readonly skippedSkills?: readonly string[];
  readonly mcpServers?: readonly string[];
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function list(value: unknown, field: string): string[] {
  const entries = match(value)
    .with(P.string, (value) => value.split(","))
    .with(P.array(P._), (value) => value)
    .otherwise(() => {
      throw new Error(`${field} must be an explicit list`);
    });
  return [...new Set(entries.map((entry) => requiredString(entry, field)))];
}

function positiveTurns(value: unknown, field = "max_turns"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function thinking(value: unknown): ThinkingLevel | undefined {
  if (value === undefined) return undefined;
  const level = THINKING_LEVELS.find((candidate) => candidate === value);
  if (level === undefined) throw new Error("Unknown thinking level");
  return level;
}

/** Resolve trusted specialist configuration; never fall back to ambient capabilities or models. */
export async function resolveSpecialist(
  name: string,
  markdown: string,
  catalog: SpecialistCatalog,
  overrides: AssignmentOverrides = {},
): Promise<ResolvedSpecialist> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) throw new Error("Invalid specialist name");
  const { frontmatter: fields, body } = parseFrontmatter(markdown);
  if (fields.permission !== undefined) {
    throw new Error(
      "permission maps are not enforced; replace them with explicit tools and policy bundles",
    );
  }
  if (fields.enabled !== undefined && fields.enabled !== true)
    throw new Error("Specialist is disabled");
  const description = requiredString(fields.description, "description");
  const prompt = requiredString(body, "specialist prompt");
  const allowedOverrides =
    fields.allow_overrides === undefined ? [] : list(fields.allow_overrides, "allow_overrides");
  if (allowedOverrides.some((field) => field !== "model" && field !== "thinking")) {
    throw new Error("allow_overrides supports only model and thinking");
  }
  for (const field of ["model", "thinking"] as const) {
    if (overrides[field] !== undefined && !allowedOverrides.includes(field)) {
      throw new Error(`${field} override is not permitted for ${name}`);
    }
  }
  const configuredModel = requiredString(fields.model, "model");
  const model =
    overrides.model === undefined
      ? configuredModel
      : requiredString(overrides.model, "model override");
  if (!catalog.availableModels.has(model))
    throw new Error(`Required model is unavailable: ${model}`);
  const configuredThinking = thinking(fields.thinking);
  const selectedThinking =
    overrides.thinking === undefined ? configuredThinking : thinking(overrides.thinking);
  const configuredTurns = positiveTurns(fields.max_turns);
  const configuredHardMaxTurns =
    fields.hard_max_turns === undefined
      ? undefined
      : positiveTurns(fields.hard_max_turns, "hard_max_turns");
  const maxTurns =
    overrides.maxTurns === undefined ? configuredTurns : positiveTurns(overrides.maxTurns);
  const requestedHardMaxTurns =
    overrides.hardMaxTurns === undefined
      ? undefined
      : positiveTurns(overrides.hardMaxTurns, "hardMaxTurns");
  if (requestedHardMaxTurns !== undefined && configuredHardMaxTurns === undefined) {
    throw new Error("hardMaxTurns override requires specialist hard_max_turns");
  }
  if (
    requestedHardMaxTurns !== undefined &&
    configuredHardMaxTurns !== undefined &&
    requestedHardMaxTurns > configuredHardMaxTurns
  ) {
    throw new Error("hardMaxTurns override exceeds specialist hard_max_turns");
  }
  const assignmentHardMaxTurns = requestedHardMaxTurns ?? configuredHardMaxTurns;
  if (assignmentHardMaxTurns !== undefined && maxTurns > assignmentHardMaxTurns) {
    throw new Error("maxTurns exceeds assignment hardMaxTurns");
  }
  const configuredTools = list(fields.tools, "tools");
  if (
    configuredTools.some(
      (tool) => PARENT_TOOLS.includes(tool) || tool === "*" || /^[+-]/.test(tool),
    )
  ) {
    throw new Error(
      "Child tools must be an explicit allowlist without parent delegation tools or modifiers",
    );
  }
  const tools = [...new Set([...configuredTools, ...SHARED_TOOLS])];
  const bundles = list(fields.bundles, "bundles").map((bundle) => {
    const resolved = catalog.bundles.get(bundle);
    if (!resolved) throw new Error(`Required capability bundle is unavailable: ${bundle}`);
    return resolved;
  });
  if (catalog.baseline.extensions.length === 0)
    throw new Error("Mandatory baseline extensions are missing");
  const extensions = [
    ...new Set([catalog.baseline, ...bundles].flatMap((bundle) => [...bundle.extensions])),
  ];
  const skills: Readonly<{ name: string; path: string }>[] = [];
  const skippedSkills: string[] = [];
  for (const skill of list(fields.skills, "skills")) {
    const path = catalog.skills.get(skill);
    if (!path) {
      skippedSkills.push(skill);
      continue;
    }
    if (!isAbsolute(path)) throw new Error(`Capability paths must be absolute: ${path}`);
    try {
      if (!(await stat(path)).isFile()) {
        skippedSkills.push(skill);
        continue;
      }
      await access(path, constants.R_OK);
    } catch (cause) {
      if (
        cause instanceof Error &&
        "code" in cause &&
        (cause.code === "ENOENT" || cause.code === "ENOTDIR")
      ) {
        skippedSkills.push(skill);
        continue;
      }
      throw new Error(`Required capability file is unavailable: ${path}`, { cause });
    }
    skills.push(Object.freeze({ name: skill, path }));
  }
  for (const path of extensions) {
    if (!isAbsolute(path)) throw new Error(`Capability paths must be absolute: ${path}`);
    try {
      if (!(await stat(path)).isFile()) throw new Error("Not a file");
      await access(path, constants.R_OK);
    } catch (cause) {
      throw new Error(`Required capability file is unavailable: ${path}`, { cause });
    }
  }
  // Pi otherwise leaves MCP registrations callable through codemode despite a non-MCP allowlist.
  const excludeTools = tools.some((tool) => tool.startsWith("mcp__"))
    ? [...PARENT_TOOLS]
    : [...PARENT_TOOLS, "mcp__*"];
  return Object.freeze({
    name,
    description,
    prompt,
    model,
    maxTurns,
    ...(configuredHardMaxTurns === undefined ? {} : { hardMaxTurns: configuredHardMaxTurns }),
    ...(selectedThinking === undefined ? {} : { thinking: selectedThinking }),
    tools: Object.freeze(tools),
    excludeTools: Object.freeze(excludeTools),
    extensions: Object.freeze(extensions),
    skills: Object.freeze(skills),
    skippedSkills: Object.freeze(skippedSkills),
    mcpServers: Object.freeze([
      ...new Set(
        [catalog.baseline, ...bundles].flatMap((bundle) => [...(bundle.mcpServers ?? [])]),
      ),
    ]),
  });
}

function matches(pattern: string, name: string): boolean {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(name);
}

/** Check the loaded child's actual callable tools before it can execute an assignment. */
export function verifyChildCapabilities(
  config: ResolvedSpecialist,
  callableNames: readonly string[],
): void {
  for (const pattern of config.tools) {
    if (!callableNames.some((name) => matches(pattern, name))) {
      throw new Error(`Required child tool is unavailable: ${pattern}`);
    }
  }
  for (const name of callableNames) {
    if (
      config.excludeTools.some((pattern) => matches(pattern, name)) ||
      !config.tools.some((pattern) => matches(pattern, name))
    ) {
      throw new Error(`Unexpected callable child tool: ${name}`);
    }
  }
}
