import { describe, expect, test } from "bun:test";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { rankDiscovery } from "../../../lib/discovery-ranking";
import { resolveSkillVisibility } from "../../shared/skill-visibility";
import { searchSkillsBm25 } from "../index";

const skills: Skill[] = [
  { name: "bun", description: "Run JavaScript tests and scripts" },
  { name: "xstate", description: "Build XState machines and actors" },
  { name: "grilling", description: "Interrogate a decision" },
].map((skill) => ({
  ...skill,
  filePath: `/skills/${skill.name}/SKILL.md`,
  baseDir: `/skills/${skill.name}`,
  sourceInfo: {} as Skill["sourceInfo"],
  disableModelInvocation: false,
}));

describe("skill discovery", () => {
  test("BM25 ranks names and descriptions with bounded results", () => {
    expect(searchSkillsBm25(skills, "xstate actors", 1).map((hit) => hit.name)).toEqual(["xstate"]);
    expect(searchSkillsBm25(skills, "unknown term")).toEqual([]);
  });

  test("shared classifier failure falls back to BM25 matches", async () => {
    const catalog = resolveSkillVisibility(
      skills,
      { skillTweaks: { disableModelInvocation: ["grilling"] } },
      {},
    ).eligibleSkills;
    const lexical = searchSkillsBm25(catalog, "xstate");
    const ranked = await rankDiscovery(catalog, lexical, "xstate", 3, {
      modelRegistry: {} as Parameters<typeof rankDiscovery>[4]["modelRegistry"],
      request: async () => ({ ok: false, stage: "request", reason: "timeout" }),
    });
    expect(ranked.rankingSource).toBe("lexical");
    expect(ranked.matches.map((hit) => hit.name)).toEqual(["xstate"]);
  });
});
