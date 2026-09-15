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

const ACTIVE_AGENT_MARKER = /^<active_agent\s+name=(?:"([^"\r\n]+)"|'([^'\r\n]+)')[^>]*\/>\s*$/u;

function activeAgentName(systemPrompt: string | undefined): string | undefined {
  if (systemPrompt === undefined) return undefined;

  for (const line of systemPrompt.split("\n")) {
    const match = ACTIVE_AGENT_MARKER.exec(line);
    if (match !== null) return match[1] ?? match[2];
  }
  return undefined;
}

function configuredSkillNames(
  value: unknown,
  path: string,
  agentName: string | undefined,
): string[] {
  if (value === undefined) return [];
  if (isRecord(value) === false) throw new Error(`${path}: expected an object`);

  const unknownFields = Object.keys(value).filter(
    (field) => field !== "disableModelInvocation" && field !== "modelInvocationAgents",
  );
  if (unknownFields.length > 0) {
    throw new Error(`${path}.${unknownFields[0]}: unknown field`);
  }

  const names = value.disableModelInvocation;
  if (names !== undefined && Array.isArray(names) === false) {
    throw new Error(`${path}.disableModelInvocation: expected an array`);
  }

  const disabled = (names ?? []).map((name, index) => {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new Error(`${path}.disableModelInvocation[${index}]: expected a non-empty string`);
    }
    return name.trim();
  });

  const invocationAgents = value.modelInvocationAgents;
  if (invocationAgents === undefined) return disabled;
  if (isRecord(invocationAgents) === false) {
    throw new Error(`${path}.modelInvocationAgents: expected an object`);
  }

  for (const [skillName, allowedAgents] of Object.entries(invocationAgents)) {
    if (skillName.trim().length === 0) {
      throw new Error(`${path}.modelInvocationAgents: expected non-empty skill names`);
    }
    if (Array.isArray(allowedAgents) === false || allowedAgents.length === 0) {
      throw new Error(`${path}.modelInvocationAgents.${skillName}: expected a non-empty array`);
    }
    if (
      allowedAgents.some(
        (allowedAgent) => typeof allowedAgent !== "string" || allowedAgent.trim().length === 0,
      )
    ) {
      throw new Error(`${path}.modelInvocationAgents.${skillName}: expected non-empty agent names`);
    }
    if (agentName === undefined || allowedAgents.includes(agentName) === false) {
      disabled.push(skillName.trim());
    }
  }

  return disabled;
}

export function disabledSkillNames(
  globalSettings: unknown,
  projectSettings: unknown,
  systemPrompt?: string,
): ReadonlySet<string> {
  const agentName = activeAgentName(systemPrompt);
  const names = [
    ...configuredSkillNames(
      isRecord(globalSettings) ? globalSettings.skillTweaks : undefined,
      "global skillTweaks",
      agentName,
    ),
    ...configuredSkillNames(
      isRecord(projectSettings) ? projectSettings.skillTweaks : undefined,
      "project skillTweaks",
      agentName,
    ),
  ];
  return new Set(names);
}

function configuredDisabledSkillNames(
  context: { cwd: string; isProjectTrusted(): boolean },
  systemPrompt?: string,
) {
  const settings = SettingsManager.create(context.cwd, getAgentDir(), {
    projectTrusted: context.isProjectTrusted(),
  });
  return disabledSkillNames(
    settings.getGlobalSettings(),
    settings.getProjectSettings(),
    systemPrompt,
  );
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
    const disabledNames = configuredDisabledSkillNames(context, event.systemPrompt);
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
