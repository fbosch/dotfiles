import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  createSyntheticSourceInfo,
  type ExtensionAPI,
  type ExtensionContext,
  formatSkillsForPrompt,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import lazySkills, { applyLazySkillPolicy, loadLazySkillNames } from "../lazy-skills";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-lazy-skills-"));
  temporaryDirectories.push(directory);
  return directory;
}

function skill(name: string): Skill {
  const baseDir = `/skills/${name}`;
  const filePath = join(baseDir, "SKILL.md");
  return {
    name,
    description: `${name} description`,
    filePath,
    baseDir,
    sourceInfo: createSyntheticSourceInfo(filePath, { source: "local", baseDir }),
    disableModelInvocation: false,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("lazy skills", () => {
  test("loads a strict, unique skill-name list", () => {
    const path = join(temporaryDirectory(), "lazy-skills.json");
    writeFileSync(path, '{"skills":["alpha-skill","beta"]}\n');

    expect([...loadLazySkillNames(path)]).toEqual(["alpha-skill", "beta"]);

    writeFileSync(path, '{"skills":["alpha","alpha"]}\n');
    expect(() => loadLazySkillNames(path)).toThrow("Duplicate lazy skill name");

    writeFileSync(path, '{"skills":["Invalid Skill"]}\n');
    expect(() => loadLazySkillNames(path)).toThrow("Invalid lazy skill name");

    writeFileSync(path, '{"skills":[],"extra":true}\n');
    expect(() => loadLazySkillNames(path)).toThrow('must contain only a "skills" array');
  });

  test("removes configured skills from the catalogue without mutating the registry", () => {
    const lazy = skill("lazy-skill");
    const visible = skill("visible-skill");
    const catalogue = formatSkillsForPrompt([lazy, visible]);
    const prompt = `base${catalogue}\n\nappended by another extension`;

    const filtered = applyLazySkillPolicy(prompt, [lazy, visible], new Set([lazy.name]));

    expect(filtered).not.toContain("<name>lazy-skill</name>");
    expect(filtered).toContain("<name>visible-skill</name>");
    expect(filtered).toEndWith("appended by another extension");
    expect(lazy.disableModelInvocation).toBeFalse();
    expect(lazy.filePath).toBe("/skills/lazy-skill/SKILL.md");
  });

  test("leaves custom prompts and unmatched policies unchanged", () => {
    const available = skill("available-skill");

    expect(applyLazySkillPolicy("custom prompt", [available], new Set([available.name]))).toBe(
      "custom prompt",
    );
    const prompt = `base${formatSkillsForPrompt([available])}`;
    expect(applyLazySkillPolicy(prompt, [available], new Set(["other-skill"]))).toBe(prompt);
  });

  test("filters through the extension lifecycle", () => {
    let handler:
      | ((
          event: BeforeAgentStartEvent,
          ctx: ExtensionContext,
        ) => BeforeAgentStartEventResult | undefined)
      | undefined;
    const pi = {
      on(event: string, registeredHandler: typeof handler) {
        if (event === "before_agent_start") handler = registeredHandler;
      },
    } as unknown as ExtensionAPI;
    lazySkills(pi);

    const lazy = skill("learning-opportunities");
    const visible = skill("visible-skill");
    const event = {
      type: "before_agent_start",
      prompt: "Teach this",
      systemPrompt: `base${formatSkillsForPrompt([lazy, visible])}`,
      systemPromptOptions: { cwd: "/project", skills: [lazy, visible] },
    } as BeforeAgentStartEvent;

    const result = handler?.(event, {} as ExtensionContext);
    expect(result?.systemPrompt).not.toContain("<name>learning-opportunities</name>");
    expect(result?.systemPrompt).toContain("<name>visible-skill</name>");
  });
});
