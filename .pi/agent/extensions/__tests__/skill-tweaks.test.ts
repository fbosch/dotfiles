import { describe, expect, test } from "bun:test";
import { formatSkillsForPrompt, type Skill } from "@earendil-works/pi-coding-agent";
import { applySkillTweaks, disabledSkillNames } from "../skill-tweaks";

function skill(name: string, disableModelInvocation = false): Skill {
  return {
    name,
    description: `${name} description`,
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    sourceInfo: {} as Skill["sourceInfo"],
    disableModelInvocation,
  };
}

describe("skill tweaks", () => {
  test("combines global and project disableModelInvocation names", () => {
    expect(
      disabledSkillNames(
        { skillTweaks: { disableModelInvocation: ["grilling", "skill-creator"] } },
        { skillTweaks: { disableModelInvocation: ["xstate", "grilling"] } },
      ),
    ).toEqual(new Set(["grilling", "skill-creator", "xstate"]));
  });

  test("hides configured skills without mutating discovered metadata", () => {
    const skills = [skill("grilling"), skill("writing-clearly")];
    const prompt = `base${formatSkillsForPrompt(skills, "read")}\n\nend`;

    const tweaked = applySkillTweaks(prompt, skills, new Set(["grilling"]), "read");

    expect(tweaked).not.toContain("<name>grilling</name>");
    expect(tweaked).toContain("<name>writing-clearly</name>");
    expect(tweaked).toContain("\n\nend");
    expect(skills.map(({ disableModelInvocation }) => disableModelInvocation)).toEqual([
      false,
      false,
    ]);
  });

  test("removes the skill section when every skill is disabled", () => {
    const skills = [skill("grilling")];
    const prompt = `base${formatSkillsForPrompt(skills, "bash")}\n\nend`;

    const tweaked = applySkillTweaks(prompt, skills, new Set(["grilling"]), "bash");

    expect(tweaked).toBe("base\n\nend");
  });

  test("leaves prompts unchanged when no overrides are configured", () => {
    const skills = [skill("writing-clearly")];
    const prompt = formatSkillsForPrompt(skills, "read");

    expect(applySkillTweaks(prompt, skills, new Set(), "read")).toBe(prompt);
  });
});
