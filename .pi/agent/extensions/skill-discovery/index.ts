import type { Usage } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  getAgentDir,
  SettingsManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  compactDiscoveryDescription,
  type DiscoveryMatch,
  rankDiscovery,
} from "../../lib/discovery-ranking";
import { replaceSkillCatalog } from "../shared/skill-prompt";
import { coldSkillNames, disabledSkillNames } from "../skill-tweaks";
import { resolveClassifierToolDiscoveryConfig } from "../tool-discovery";

const MAX_MATCHES = 10;
const DEFAULT_MATCHES = 3;
const SEARCH_GUIDANCE =
  "\n\nSkills provide specialized instructions. Use search_skills to search available skills by task or name, then read the selected SKILL.md before following it. Explicit /skill:name commands remain available.";

export interface SearchableSkill {
  name: string;
  description: string;
  filePath: string;
}

function tokens(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function searchSkillsBm25(
  skills: readonly SearchableSkill[],
  query: string,
  limit = DEFAULT_MATCHES,
): DiscoveryMatch[] {
  const terms = [...new Set(tokens(query))];
  if (terms.length === 0 || skills.length === 0) return [];
  const documents = skills.map((skill) => [
    ...tokens(skill.name),
    ...tokens(skill.name),
    ...tokens(skill.name),
    ...tokens(skill.description),
    ...tokens(skill.description),
  ]);
  const averageLength =
    documents.reduce((sum, document) => sum + document.length, 0) / documents.length;
  return skills
    .map((skill, index) => {
      const document = documents[index] ?? [];
      const score = terms.reduce((total, term) => {
        const frequency = document.filter((word) => word === term).length;
        if (frequency === 0) return total;
        const containing = documents.filter((words) => words.includes(term)).length;
        const idf = Math.log(1 + (documents.length - containing + 0.5) / (containing + 0.5));
        return (
          total +
          (idf * frequency * 2.5) /
            (frequency + 1.5 * (0.25 + (0.75 * document.length) / averageLength))
        );
      }, 0);
      return { name: skill.name, score };
    })
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, limit);
}

export function compactSkillPrompt(
  prompt: string,
  skills: readonly Skill[],
  cold: ReadonlySet<string>,
  disabled: ReadonlySet<string>,
  readTool: "read" | "bash",
): string {
  const visible = skills.filter((skill) => !cold.has(skill.name) && !disabled.has(skill.name));
  const filtered = replaceSkillCatalog(prompt, visible, readTool);
  return filtered.includes(SEARCH_GUIDANCE) ? filtered : filtered + SEARCH_GUIDANCE;
}

export function searchableSkills(
  skills: readonly Skill[] | undefined,
  disabled: ReadonlySet<string>,
): SearchableSkill[] {
  return (skills ?? [])
    .filter((skill) => !skill.disableModelInvocation && !disabled.has(skill.name))
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      filePath: skill.filePath,
    }));
}

export default function skillDiscovery(pi: ExtensionAPI): void {
  let catalog: SearchableSkill[] = [];
  pi.on("before_agent_start", (event, ctx) => {
    const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
      projectTrusted: ctx.isProjectTrusted(),
    });
    const excluded = disabledSkillNames(
      settings.getGlobalSettings(),
      settings.getProjectSettings(),
      event.systemPrompt,
    );
    catalog = searchableSkills(event.systemPromptOptions.skills, excluded);
    const selected = event.systemPromptOptions.selectedTools ?? [];
    // Do not hide the catalog in restricted agents that cannot search or read skills.
    if (!selected.includes("search_skills")) return;
    const readTool = selected.includes("read")
      ? "read"
      : selected.includes("bash")
        ? "bash"
        : undefined;
    if (readTool === undefined) return;
    const cold = coldSkillNames(
      settings.getGlobalSettings(),
      settings.getProjectSettings(),
      event.systemPromptOptions.skills ?? [],
    );
    const systemPrompt = compactSkillPrompt(
      event.systemPrompt,
      event.systemPromptOptions.skills ?? [],
      cold,
      excluded,
      readTool,
    );
    if (systemPrompt !== event.systemPrompt) return { systemPrompt };
  });

  pi.registerTool(
    defineTool({
      name: "search_skills",
      label: "Search skills",
      description:
        "Search available skills by name or task. Returns paths to read the selected SKILL.md; does not load skill instructions automatically.",
      promptSnippet: "Find relevant skills before reading their instructions",
      parameters: Type.Object(
        {
          query: Type.String({
            minLength: 1,
            maxLength: 500,
            description: "Task, capability, or skill name to search for.",
          }),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_MATCHES })),
        },
        { additionalProperties: false },
      ),
      executionMode: "sequential",
      async execute(_id, params, signal, _onUpdate, ctx) {
        let inferenceUsage: Usage | undefined;
        try {
          const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
            projectTrusted: ctx.isProjectTrusted(),
          });
          const config = resolveClassifierToolDiscoveryConfig(
            settings.getGlobalSettings(),
            settings.getProjectSettings(),
          );
          const limit = params.limit ?? DEFAULT_MATCHES;
          const lexical = searchSkillsBm25(catalog, params.query, catalog.length);
          const ranking = await rankDiscovery(catalog, lexical, params.query, limit, {
            modelRegistry: ctx.modelRegistry,
            enabled: config.enabled,
            timeoutMs: config.timeoutMs,
            settingsContext: ctx,
            ...(signal === undefined ? {} : { signal }),
            onUsage: (usage) => {
              inferenceUsage = usage;
            },
          });
          signal?.throwIfAborted();
          const byName = new Map(catalog.map((skill) => [skill.name, skill]));
          const matches = ranking.matches.flatMap((match) => {
            const skill = byName.get(match.name);
            return skill === undefined ? [] : [skill];
          });
          return {
            ...(ranking.usage === undefined ? {} : { usage: ranking.usage }),
            content: [
              {
                type: "text",
                text:
                  matches.length === 0
                    ? `No skills found for: ${params.query} (ranking: ${ranking.rankingSource})`
                    : `${matches.map((skill) => `- ${skill.name}: ${compactDiscoveryDescription(skill.description)}\n  ${skill.filePath}`).join("\n")}\nRanking source: ${ranking.rankingSource}`,
              },
            ],
            details: {
              matches: matches.map((skill) => skill.name),
              rankingSource: ranking.rankingSource,
            },
          };
        } catch (error) {
          if (inferenceUsage === undefined) throw error;
          return {
            isError: true,
            usage: inferenceUsage,
            content: [
              { type: "text", text: error instanceof Error ? error.message : String(error) },
            ],
            details: { matches: [], rankingSource: "classifier" as const },
          };
        }
      },
    }),
  );
}
