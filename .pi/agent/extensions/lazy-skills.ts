import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ExtensionAPI,
  formatSkillsForPrompt,
  getAgentDir,
  type Skill,
} from "@earendil-works/pi-coding-agent";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

export function loadLazySkillNames(path: string): ReadonlySet<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot load lazy skills from ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (isRecord(parsed) === false || Object.keys(parsed).some((key) => key !== "skills")) {
    throw new Error(`Lazy skills config must contain only a "skills" array: ${path}`);
  }
  if (Array.isArray(parsed.skills) === false) {
    throw new Error(`Lazy skills config requires a "skills" array: ${path}`);
  }

  const names = new Set<string>();
  for (const value of parsed.skills) {
    if (typeof value !== "string" || SKILL_NAME_PATTERN.test(value) === false) {
      throw new Error(`Invalid lazy skill name in ${path}: ${String(value)}`);
    }
    if (names.has(value)) {
      throw new Error(`Duplicate lazy skill name in ${path}: ${value}`);
    }
    names.add(value);
  }
  return names;
}

export function applyLazySkillPolicy(
  systemPrompt: string,
  skills: readonly Skill[],
  lazySkillNames: ReadonlySet<string>,
): string {
  if (skills.some((skill) => lazySkillNames.has(skill.name)) === false) return systemPrompt;

  const advertisedSkills = formatSkillsForPrompt([...skills]);
  if (advertisedSkills.length === 0 || systemPrompt.includes(advertisedSkills) === false) {
    return systemPrompt;
  }

  const filteredSkills = skills.map((skill) =>
    lazySkillNames.has(skill.name) ? { ...skill, disableModelInvocation: true } : skill,
  );
  return systemPrompt.replace(advertisedSkills, formatSkillsForPrompt(filteredSkills));
}

// Load one policy snapshot per extension generation; /reload imports a fresh generation.
const LAZY_SKILL_NAMES = loadLazySkillNames(join(getAgentDir(), "lazy-skills.json"));

export default function lazySkills(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => ({
    systemPrompt: applyLazySkillPolicy(
      event.systemPrompt,
      event.systemPromptOptions.skills ?? [],
      LAZY_SKILL_NAMES,
    ),
  }));
}
