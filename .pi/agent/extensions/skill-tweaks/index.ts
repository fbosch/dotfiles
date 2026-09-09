import {
  type BeforeAgentStartEvent,
  type ExtensionAPI,
  formatSkillsForPrompt,
  getAgentDir,
  SettingsManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";

const SKILL_PROMPT_START =
  "\n\nThe following skills provide specialized instructions for specific tasks.";
const SKILL_PROMPT_END = "\n</available_skills>";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function configuredSkillNames(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (isRecord(value) === false) throw new Error(`${path}: expected an object`);

  const unknownFields = Object.keys(value).filter((field) => field !== "disableModelInvocation");
  if (unknownFields.length > 0) {
    throw new Error(`${path}.${unknownFields[0]}: unknown field`);
  }

  const names = value.disableModelInvocation;
  if (names === undefined) return [];
  if (Array.isArray(names) === false) {
    throw new Error(`${path}.disableModelInvocation: expected an array`);
  }

  return names.map((name, index) => {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new Error(`${path}.disableModelInvocation[${index}]: expected a non-empty string`);
    }
    return name.trim();
  });
}

export function disabledSkillNames(
  globalSettings: unknown,
  projectSettings: unknown,
): ReadonlySet<string> {
  const names = [
    ...configuredSkillNames(
      isRecord(globalSettings) ? globalSettings.skillTweaks : undefined,
      "global skillTweaks",
    ),
    ...configuredSkillNames(
      isRecord(projectSettings) ? projectSettings.skillTweaks : undefined,
      "project skillTweaks",
    ),
  ];
  return new Set(names);
}

function configuredDisabledSkillNames(context: { cwd: string; isProjectTrusted(): boolean }) {
  const settings = SettingsManager.create(context.cwd, getAgentDir(), {
    projectTrusted: context.isProjectTrusted(),
  });
  return disabledSkillNames(settings.getGlobalSettings(), settings.getProjectSettings());
}

function fileReadTool(event: BeforeAgentStartEvent): "read" | "bash" | undefined {
  const selectedTools = event.systemPromptOptions.selectedTools ?? [];
  if (selectedTools.includes("read")) return "read";
  if (selectedTools.includes("bash")) return "bash";
  return undefined;
}

export function applySkillTweaks(
  systemPrompt: string,
  skills: readonly Skill[] | undefined,
  disabledNames: ReadonlySet<string>,
  readTool: "read" | "bash" | undefined,
): string {
  if (skills === undefined || disabledNames.size === 0 || readTool === undefined) {
    return systemPrompt;
  }

  const skillPromptStart = systemPrompt.indexOf(SKILL_PROMPT_START);
  if (skillPromptStart === -1) return systemPrompt;

  const skillPromptEnd = systemPrompt.indexOf(SKILL_PROMPT_END, skillPromptStart);
  if (skillPromptEnd === -1) return systemPrompt;

  const tweakedSkills = skills.map((skill) =>
    disabledNames.has(skill.name) ? { ...skill, disableModelInvocation: true } : skill,
  );
  const replacement = formatSkillsForPrompt(tweakedSkills, readTool);
  return (
    systemPrompt.slice(0, skillPromptStart) +
    replacement +
    systemPrompt.slice(skillPromptEnd + SKILL_PROMPT_END.length)
  );
}

export default function skillTweaks(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event, context) => {
    const disabledNames = configuredDisabledSkillNames(context);
    const systemPrompt = applySkillTweaks(
      event.systemPrompt,
      event.systemPromptOptions.skills,
      disabledNames,
      fileReadTool(event),
    );
    if (systemPrompt === event.systemPrompt) return;
    return { systemPrompt };
  });
}
