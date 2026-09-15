import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExtensionAPI,
  getAgentDir,
  loadSkills,
  SettingsManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { disabledSkillNames } from "./skill-tweaks";

interface CommandAlias {
  trigger: string;
  target: string;
  description: string;
}

const COMMAND_ALIASES: readonly CommandAlias[] = [
  {
    trigger: "/exit",
    target: "/quit",
    description: "Quit pi",
  },
  {
    trigger: "/qa",
    target: "/quit",
    description: "Quit pi",
  },
];

export function getCommandAlias(input: string): CommandAlias | undefined {
  return COMMAND_ALIASES.find((alias) => alias.trigger === input);
}

export function getSkillCommandAlias(
  input: string,
  skills: readonly Skill[],
  configuredDisabledNames: ReadonlySet<string> = new Set(),
): string | undefined {
  const match = /^\/([^\s]+)([\s\S]*)$/.exec(input);
  const name = match?.[1];
  if (name === undefined || name.startsWith("skill:")) return undefined;

  const argumentsSuffix = match?.[2] ?? "";
  const skill = skills.find((candidate) => candidate.name === name);
  if (
    skill === undefined ||
    (skill.disableModelInvocation === false && configuredDisabledNames.has(name) === false)
  ) {
    return undefined;
  }

  return `/skill:${name}${argumentsSuffix}`;
}

function discoverSkills(context: { cwd: string; isProjectTrusted(): boolean }): {
  skills: Skill[];
  configuredDisabledNames: ReadonlySet<string>;
} {
  const agentDir = getAgentDir();
  const trusted = context.isProjectTrusted();
  const settings = SettingsManager.create(context.cwd, agentDir, { projectTrusted: trusted });
  const globalSettings = settings.getGlobalSettings();
  const projectSettings = settings.getProjectSettings();
  const skillPaths = [
    ...(globalSettings.skills ?? []),
    ...(trusted ? (projectSettings.skills ?? []) : []),
  ];

  // Avoid loading project-local defaults before Pi has trusted the project.
  const discoveryCwd = trusted
    ? context.cwd
    : join(tmpdir(), "pi-command-aliases-untrusted-project");
  const { skills } = loadSkills({
    cwd: discoveryCwd,
    agentDir,
    skillPaths,
    includeDefaults: true,
  });

  return {
    skills,
    configuredDisabledNames: disabledSkillNames(globalSettings, projectSettings),
  };
}

export default function commandAliases(pi: ExtensionAPI): void {
  let skills: readonly Skill[] = [];
  let configuredDisabledNames: ReadonlySet<string> = new Set();

  pi.on("session_start", (_event, context) => {
    ({ skills, configuredDisabledNames } = discoverSkills(context));
  });

  pi.on("input", async (event, ctx) => {
    if (getCommandAlias(event.text) !== undefined) {
      ctx.shutdown();
      return { action: "handled" };
    }

    const skillAlias = getSkillCommandAlias(event.text, skills, configuredDisabledNames);
    if (skillAlias === undefined) return;
    return { action: "transform", text: skillAlias };
  });
}
