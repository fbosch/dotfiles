import { describe, expect, test } from "bun:test";
import { formatSkillsForPrompt, type Skill } from "@earendil-works/pi-coding-agent";
import { rankDiscovery } from "../../../lib/discovery-ranking";
import { applySkillTweaks, coldSkillNames, disabledSkillNames } from "../../skill-tweaks";
import { compactSkillPrompt, searchableSkills, searchSkillsBm25 } from "../index";

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
const cold = new Set(["xstate"]);
const disabled = new Set(["grilling"]);
const prompt = `before${formatSkillsForPrompt(skills, "read")}\n\nafter`;

describe("skill discovery", () => {
  test("BM25 ranks names and descriptions with bounded results", () => {
    expect(searchSkillsBm25(skills, "xstate actors", 1).map((hit) => hit.name)).toEqual(["xstate"]);
    expect(searchSkillsBm25(skills, "unknown term")).toEqual([]);
  });

  test("hot and cold skills are searchable; explicit-only skills are excluded", () => {
    const candidates = searchableSkills(skills, disabled);
    expect(candidates.map((skill) => skill.name)).toEqual(["bun", "xstate"]);
    expect(searchSkillsBm25(candidates, "xstate").map((hit) => hit.name)).toEqual(["xstate"]);
    expect(
      searchableSkills(
        skills.map((skill) => ({ ...skill, disableModelInvocation: true })),
        new Set(),
      ),
    ).toEqual([]);
  });

  test("prompt retains hot metadata but omits cold and explicit-only metadata", () => {
    const compact = compactSkillPrompt(prompt, skills, cold, disabled, "read");
    expect(compact).toContain("Run JavaScript tests and scripts");
    expect(compact).not.toContain("XState machines");
    expect(compact).not.toContain("Interrogate a decision");
    expect(compact).toContain("Use search_skills");
    expect(compact).toStartWith("before");
    expect(compact).toContain("\n\nafter");
  });
  test("native skills wrapper survives filtering without leaking cold metadata", () => {
    const xml = formatSkillsForPrompt(skills, "read");
    const catalog = xml.slice(xml.indexOf("<available_skills>"));
    const native = `before\n\n<skills>\nThe following skills provide specialized instructions for specific tasks.\nUse the read tool.\n${catalog}\n</skills>\n\nafter`;
    const compact = compactSkillPrompt(native, skills, cold, disabled, "read");
    expect(compact).toContain("<skills>\nThe following skills");
    expect(compact).toContain("</skills>\n\nafter");
    expect(compact).not.toContain("<name>xstate</name>");
    expect(compact).not.toContain("<name>grilling</name>");
    expect(compact).toContain("<name>bun</name>");
    expect(compactSkillPrompt(compact, skills, cold, disabled, "read")).toBe(compact);
  });

  test("empty hot catalog still exposes discovery guidance", () => {
    const compact = compactSkillPrompt(
      prompt,
      skills,
      new Set(skills.map((skill) => skill.name)),
      disabled,
      "read",
    );
    expect(compact).not.toContain("<available_skills>");
    expect(compact).toContain("search_skills");
  });

  test("skill-tweaks cannot restore cold metadata after discovery", () => {
    const compact = compactSkillPrompt(prompt, skills, cold, disabled, "read");
    const tweaked = applySkillTweaks(compact, skills, new Set([...cold, ...disabled]), "read");
    expect(tweaked).not.toContain("XState machines");
    expect(tweaked).toContain("Run JavaScript tests");
    expect(tweaked).toContain("search_skills");
  });

  test("global allowlist defaults new user skills cold without disabling search", () => {
    const global = { skillTweaks: { warmSkills: ["bun"], disableModelInvocation: ["grilling"] } };
    expect([...coldSkillNames(global, {}, skills)]).toEqual(["xstate", "grilling"]);
    expect([...disabledSkillNames(global, {})]).toEqual(["grilling"]);
    expect(searchableSkills(skills, disabled).map((skill) => skill.name)).toEqual([
      "bun",
      "xstate",
    ]);
  });

  test("project discovery scope stays warm regardless of global allowlist", () => {
    const local = skills.map((skill) => ({
      ...skill,
      sourceInfo: { ...skill.sourceInfo, scope: "project" as const },
    }));
    expect([...coldSkillNames({}, {}, local)]).toEqual([]);
    expect([...coldSkillNames({}, { skillTweaks: { coldSkills: ["xstate"] } }, local)]).toEqual([
      "xstate",
    ]);
    const user = local.map((skill) => ({
      ...skill,
      sourceInfo: { ...skill.sourceInfo, scope: "user" as const },
    }));
    expect([...coldSkillNames({}, {}, user)]).toEqual(["bun", "xstate", "grilling"]);
  });

  test("project warm override promotes global skills but cannot bypass invocation restrictions", () => {
    const project = { skillTweaks: { warmSkills: ["xstate", "grilling"], coldSkills: ["bun"] } };
    expect([...coldSkillNames({ skillTweaks: { warmSkills: ["bun"] } }, project, skills)]).toEqual([
      "bun",
    ]);
    const denied = disabledSkillNames(
      { skillTweaks: { disableModelInvocation: ["grilling"] } },
      project,
    );
    expect(searchableSkills(skills, denied).map((skill) => skill.name)).not.toContain("grilling");
  });

  test("malformed visibility settings fail explicitly", () => {
    expect(() => coldSkillNames({ skillTweaks: { warmSkills: "bun" } }, {}, skills)).toThrow();
    expect(() => coldSkillNames({}, { skillTweaks: { coldSkills: [""] } }, skills)).toThrow();
    expect(() => coldSkillNames({ skillTweaks: { coldSkills: ["xstate"] } }, {}, skills)).toThrow(
      "use warmSkills",
    );
  });

  test("shared classifier failure falls back to BM25 cold matches", async () => {
    const catalog = searchableSkills(skills, disabled);
    const lexical = searchSkillsBm25(catalog, "xstate");
    const ranked = await rankDiscovery(catalog, lexical, "xstate", 3, {
      modelRegistry: {} as Parameters<typeof rankDiscovery>[4]["modelRegistry"],
      request: async () => ({ ok: false, stage: "request", reason: "timeout" }),
    });
    expect(ranked.rankingSource).toBe("lexical");
    expect(ranked.matches.map((hit) => hit.name)).toEqual(["xstate"]);
  });
});
