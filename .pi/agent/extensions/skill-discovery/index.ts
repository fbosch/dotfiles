import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  compactDiscoveryDescription,
  type DiscoveryMatch,
  DiscoverySearchError,
  searchCatalog,
} from "../../lib/discovery-ranking";
import { fullSkillCatalog } from "../shared/skill-prompt";
import { configuredSkillVisibility } from "../shared/skill-visibility";
import { createSkillSelectionExtension } from "./selection";

const MAX_MATCHES = 10;
const DEFAULT_MATCHES = 3;

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

export default function skillDiscovery(
  pi: ExtensionAPI,
  selectionDependencies: Parameters<typeof createSkillSelectionExtension>[0] = {},
): void {
  let catalog: SearchableSkill[] = [];
  pi.on("before_agent_start", (event, ctx) => {
    const visibility = configuredSkillVisibility(
      ctx,
      fullSkillCatalog(pi.events, event.systemPromptOptions),
      event.systemPrompt,
    );
    catalog = visibility.eligibleSkills;
    const promptSkills = visibility.promptSkills(event.systemPromptOptions);
    if (promptSkills !== undefined) event.systemPromptOptions.skills = promptSkills;
  });
  createSkillSelectionExtension(selectionDependencies)(pi);

  pi.registerTool(
    defineTool({
      name: "skill_search",
      label: "Search skills",
      description:
        "Search available skills by name or task. Returns paths to read the selected SKILL.md; does not load skill instructions automatically.",
      promptSnippet: "Find relevant skills before reading their instructions",
      promptGuidelines: [
        "For specialized work not covered by the advertised skills, use skill_search to find relevant skills by task or name. Read the selected SKILL.md before following it. Explicit /skill:name commands remain available.",
      ],
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
        try {
          const ranking = await searchCatalog(catalog, {
            key: (skill) => skill.name,
            describe: (skill) => skill.description,
            lexical: searchSkillsBm25(catalog, params.query, catalog.length),
            query: params.query,
            limit: params.limit ?? DEFAULT_MATCHES,
            context: ctx,
            ...(signal === undefined ? {} : { signal }),
          });
          const matches = ranking.items;
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
          if (!(error instanceof DiscoverySearchError)) throw error;
          return {
            isError: true,
            usage: error.usage,
            content: [{ type: "text", text: error.message }],
            details: { matches: [], rankingSource: "classifier" as const },
          };
        }
      },
    }),
  );
}
