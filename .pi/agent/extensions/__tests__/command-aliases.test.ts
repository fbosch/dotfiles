import { describe, expect, test } from "bun:test";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { getSkillCommandAlias } from "../command-aliases";

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

describe("skill command aliases", () => {
  test("aliases a model-hidden skill and preserves its arguments", () => {
    expect(getSkillCommandAlias("/bro explain this", [skill("bro", true)])).toBe(
      "/skill:bro explain this",
    );
  });

  test("aliases a skill hidden through skillTweaks", () => {
    expect(getSkillCommandAlias("/grill-me", [skill("grill-me")], new Set(["grill-me"]))).toBe(
      "/skill:grill-me",
    );
  });

  test("leaves model-invocable skills and unrelated commands unchanged", () => {
    const skills = [skill("writing-clearly")];

    expect(getSkillCommandAlias("/writing-clearly", skills)).toBeUndefined();
    expect(getSkillCommandAlias("/review src/index.ts", skills)).toBeUndefined();
  });

  test("does not rewrite the native skill command", () => {
    expect(getSkillCommandAlias("/skill:bro explain this", [skill("bro", true)])).toBeUndefined();
  });
});
