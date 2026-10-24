import { describe, expect, test } from "bun:test";
import { coldSkillNames, disabledSkillNames } from "../skill-tweaks";

describe("skill tweaks", () => {
  test("combines global and project disableModelInvocation names", () => {
    expect(
      disabledSkillNames(
        { skillTweaks: { disableModelInvocation: ["grilling", "skill-creator"] } },
        { skillTweaks: { disableModelInvocation: ["xstate", "grilling"] } },
      ),
    ).toEqual(new Set(["grilling", "skill-creator", "xstate"]));
  });

  test("disables conditional skills outside their allowed agent", () => {
    const settings = {
      skillTweaks: {
        modelInvocationAgents: {
          "ascii-visualizer": ["visualizer"],
          "mermaid-diagrams": ["visualizer"],
        },
      },
    };

    expect(disabledSkillNames(settings, {})).toEqual(
      new Set(["ascii-visualizer", "mermaid-diagrams"]),
    );
    expect(
      disabledSkillNames(settings, {}, '<active_agent name="review"/>\n\n# Environment'),
    ).toEqual(new Set(["ascii-visualizer", "mermaid-diagrams"]));
  });

  test("keeps conditional skills visible to an allowed agent", () => {
    const settings = {
      skillTweaks: {
        modelInvocationAgents: {
          "ascii-visualizer": ["visualizer"],
          "mermaid-diagrams": ["visualizer"],
        },
      },
    };

    expect(
      disabledSkillNames(settings, {}, '<active_agent name="visualizer"/>\n\n# Environment'),
    ).toEqual(new Set());
  });

  test.each([
    { disableModelInvocation: "grilling" },
    { disableModelInvocation: [""] },
    { modelInvocationAgents: { "mermaid-diagrams": [] } },
    { modelInvocationAgents: { "mermaid-diagrams": [""] } },
    { unexpected: true },
  ])("rejects invalid invocation restrictions: %j", (skillTweaks) => {
    expect(() => disabledSkillNames({ skillTweaks }, {})).toThrow();
  });
});
test.each([
  { global: { skillTweaks: { warmSkills: "bun" } }, project: {} },
  { global: {}, project: { skillTweaks: { coldSkills: [""] } } },
  { global: { skillTweaks: { coldSkills: ["bun"] } }, project: {} },
])("visibility settings reject malformed or unsupported scope: %j", ({ global, project }) => {
  expect(() => coldSkillNames(global, project, [])).toThrow();
});
