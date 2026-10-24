import {
  type BeforeAgentStartEvent,
  type ExtensionAPI,
  getAgentDir,
  SettingsManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { activeAgentName } from "../shared/active-agent";
import { isRecord } from "../shared/is-record";
import { canDiscoverSkills, fullSkillCatalog } from "../shared/skill-prompt";

function configuredSkillNames(
  value: unknown,
  path: string,
  agentName: string | undefined,
): string[] {
  if (value === undefined) return [];
  if (isRecord(value) === false) throw new Error(`${path}: expected an object`);

  const unknownFields = Object.keys(value).filter(
    (field) =>
      !["disableModelInvocation", "modelInvocationAgents", "warmSkills", "coldSkills"].includes(
        field,
      ),
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

function visibilityNames(
  settings: unknown,
  scope: string,
  field: "warmSkills" | "coldSkills",
): ReadonlySet<string> {
  const tweaks = isRecord(settings) ? settings.skillTweaks : undefined;
  if (tweaks === undefined) return new Set();
  if (!isRecord(tweaks)) throw new Error(`${scope} skillTweaks: expected an object`);
  const names = tweaks[field];
  if (names === undefined) return new Set();
  if (
    !Array.isArray(names) ||
    names.some((name) => typeof name !== "string" || name.trim().length === 0)
  )
    throw new Error(`${scope} skillTweaks.${field}: expected an array of non-empty names`);
  return new Set(names.map((name: string) => name.trim()));
}

export function coldSkillNames(
  globalSettings: unknown,
  projectSettings: unknown,
  skills: readonly Skill[],
): ReadonlySet<string> {
  if (
    isRecord(globalSettings) &&
    isRecord(globalSettings.skillTweaks) &&
    globalSettings.skillTweaks.coldSkills !== undefined
  )
    throw new Error("global skillTweaks.coldSkills: use warmSkills for global visibility");
  const globalWarm = visibilityNames(globalSettings, "global", "warmSkills");
  const projectWarm = visibilityNames(projectSettings, "project", "warmSkills");
  const projectCold = visibilityNames(projectSettings, "project", "coldSkills");
  // Project discovery alone must not advertise the whole repository's skill catalog.
  return new Set(
    skills
      .filter(
        (skill) =>
          projectCold.has(skill.name) ||
          (!projectWarm.has(skill.name) && !globalWarm.has(skill.name)),
      )
      .map((skill) => skill.name),
  );
}

function configuredDisabledSkillNames(
  context: { cwd: string; isProjectTrusted(): boolean },
  systemPrompt: string,
  hideCold: boolean,
  skills: readonly Skill[],
) {
  const settings = SettingsManager.create(context.cwd, getAgentDir(), {
    projectTrusted: context.isProjectTrusted(),
  });
  const global = settings.getGlobalSettings();
  const project = settings.getProjectSettings();
  return new Set([
    ...disabledSkillNames(global, project, systemPrompt),
    ...(hideCold ? coldSkillNames(global, project, skills) : []),
  ]);
}

function fileReadTool(event: BeforeAgentStartEvent): "read" | "bash" | undefined {
  const { selectedTools, hiddenTools } = event.systemPromptOptions;
  const declared = selectedTools.filter((name) => !hiddenTools.includes(name));
  if (declared.includes("read")) return "read";
  if (declared.includes("bash")) return "bash";
  return undefined;
}

export default function skillTweaks(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event, context) => {
    const skills = fullSkillCatalog(pi.events, event.systemPromptOptions);
    const disabledNames = configuredDisabledSkillNames(
      context,
      event.systemPrompt,
      canDiscoverSkills(event.systemPromptOptions),
      skills,
    );
    if (fileReadTool(event) === undefined) return;
    event.systemPromptOptions.skills = skills.filter(
      (skill) => !disabledNames.has(skill.name) && !skill.disableModelInvocation,
    );
  });
}
