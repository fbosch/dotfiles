import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Skill } from "@earendil-works/pi-coding-agent";
import {
  configuredSkillVisibility,
  loadSkillSettings,
  resolveSkillVisibility,
} from "../skill-visibility";

function skill(name: string, explicitOnly = false): Skill {
  return {
    name,
    description: `${name} workflow`,
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    sourceInfo: {} as Skill["sourceInfo"],
    disableModelInvocation: explicitOnly,
  };
}

const catalog = [skill("bun"), skill("local"), skill("manual"), skill("explicit-only", true)];
const discoverable = { selectedTools: ["read", "skill_search"], hiddenTools: [] };
const names = (skills: readonly Skill[] | undefined) => skills?.map((item) => item.name);

describe("skill visibility", () => {
  test("requires an explicit invocation flag for recommendations", () => {
    const missingFlag = skill("missing-flag");
    Reflect.deleteProperty(missingFlag, "disableModelInvocation");
    const visibility = resolveSkillVisibility([...catalog, missingFlag], {}, {});
    expect(names(visibility.eligibleSkills)).toEqual(["bun", "local", "manual", "missing-flag"]);
    expect(names(visibility.recommendableSkills)).toEqual(["bun", "local", "manual"]);
  });
  test("combines invocation restrictions while keeping cold skills eligible", () => {
    const visibility = resolveSkillVisibility(
      catalog,
      {
        skillTweaks: {
          warmSkills: ["bun", "manual", "explicit-only"],
          disableModelInvocation: ["manual"],
        },
      },
      { skillTweaks: { disableModelInvocation: ["bun"], warmSkills: ["local"] } },
    );
    expect(names(visibility.eligibleSkills)).toEqual(["local"]);
    expect(names(visibility.promptSkills(discoverable))).toEqual(["local"]);
    expect(visibility.disabledNames).toEqual(new Set(["manual", "bun"]));

    const unrestricted = resolveSkillVisibility(
      catalog,
      { skillTweaks: { warmSkills: ["bun"] } },
      {},
    );
    expect(names(unrestricted.eligibleSkills)).toEqual(["bun", "local", "manual"]);
    expect(names(unrestricted.promptSkills(discoverable))).toEqual(["bun"]);
  });

  test("project settings cannot bypass global invocation restrictions", () => {
    const visibility = resolveSkillVisibility(
      catalog,
      { skillTweaks: { disableModelInvocation: ["manual"] } },
      { skillTweaks: { disableModelInvocation: [], warmSkills: ["manual"] } },
    );
    expect(names(visibility.eligibleSkills)).toEqual(["bun", "local"]);
    expect(names(visibility.promptSkills(discoverable))).toEqual([]);
  });

  test.each([undefined, "review", "visualizer"])(
    "applies agent-specific invocation restrictions for %s",
    (agent) => {
      const visibility = resolveSkillVisibility(
        catalog,
        {
          skillTweaks: { modelInvocationAgents: { local: ["visualizer"] }, warmSkills: ["local"] },
        },
        {},
        agent === undefined ? undefined : `<active_agent name="${agent}"/>\n\n# Environment`,
      );
      expect(names(visibility.eligibleSkills)).toEqual(
        agent === "visualizer" ? ["bun", "local", "manual"] : ["bun", "manual"],
      );
      expect(names(visibility.promptSkills(discoverable))).toEqual(
        agent === "visualizer" ? ["local"] : [],
      );
    },
  );

  test("project cold overrides both warm lists without removing search eligibility", () => {
    const visibility = resolveSkillVisibility(
      catalog,
      { skillTweaks: { warmSkills: ["bun"] } },
      { skillTweaks: { warmSkills: ["local"], coldSkills: ["bun"] } },
    );
    expect(names(visibility.promptSkills(discoverable))).toEqual(["local"]);
    expect(names(visibility.eligibleSkills)).toEqual(["bun", "local", "manual"]);
    expect(
      names(visibility.promptSkills({ selectedTools: ["bash", "skill_search"], hiddenTools: [] })),
    ).toEqual(["local"]);
  });

  test.each([
    { selectedTools: ["read"], hiddenTools: [] },
    { selectedTools: ["read", "skill_search"], hiddenTools: ["skill_search"] },
  ])("restricted declarations retain the permitted catalog: %j", (options) => {
    const visibility = resolveSkillVisibility(catalog, {}, {});
    expect(names(visibility.promptSkills(options))).toEqual(["bun", "local", "manual"]);
  });

  test.each([
    { selectedTools: ["read", "skill_search"], hiddenTools: ["read"] },
    { selectedTools: ["skill_search"], hiddenTools: [] },
    {},
  ])("leaves prompt metadata alone without a declared reader: %j", (options) => {
    expect(resolveSkillVisibility(catalog, {}, {}).promptSkills(options)).toBeUndefined();
  });

  test.each([
    { disableModelInvocation: "manual" },
    { disableModelInvocation: [""] },
    { modelInvocationAgents: { local: [] } },
    { modelInvocationAgents: { local: [""] } },
    { unexpected: true },
  ])("rejects malformed invocation restrictions: %j", (skillTweaks) => {
    expect(() => resolveSkillVisibility(catalog, { skillTweaks }, {})).toThrow();
  });

  test.each([
    { global: { skillTweaks: { warmSkills: "bun" } }, project: {} },
    { global: {}, project: { skillTweaks: { coldSkills: [""] } } },
    { global: { skillTweaks: { coldSkills: ["bun"] } }, project: {} },
  ])("rejects malformed or unsupported visibility settings: %j", ({ global, project }) => {
    expect(() =>
      resolveSkillVisibility(catalog, global, project).promptSkills(discoverable),
    ).toThrow();
  });
});

const previousDirectory = process.env.PI_CODING_AGENT_DIR;
const directories: string[] = [];
afterEach(() => {
  if (previousDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousDirectory;
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test.each([true, false])("project visibility settings follow project trust: %s", (trusted) => {
  const root = mkdtempSync(join(tmpdir(), "pi-skill-visibility-"));
  directories.push(root);
  const agentDir = join(root, "agent");
  const cwd = join(root, "project");
  mkdirSync(agentDir);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({
      skillTweaks: { warmSkills: ["bun"], disableModelInvocation: ["manual"] },
    }),
  );
  writeFileSync(
    join(cwd, ".pi/settings.json"),
    JSON.stringify({
      skillTweaks: {
        warmSkills: ["local", "manual"],
        coldSkills: ["bun"],
        disableModelInvocation: [],
      },
    }),
  );
  const visibility = configuredSkillVisibility({ cwd, isProjectTrusted: () => trusted }, catalog);
  expect(names(visibility.eligibleSkills)).toEqual(["bun", "local"]);
  expect(names(visibility.promptSkills(discoverable))).toEqual(trusted ? ["local"] : ["bun"]);
});

test("one prompt-start context loads skill settings once", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-skill-settings-"));
  directories.push(root);
  const agentDir = join(root, "agent");
  mkdirSync(agentDir);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const settingsPath = join(agentDir, "settings.json");
  writeFileSync(settingsPath, JSON.stringify({ skillTweaks: { warmSkills: ["bun"] } }));
  const context = { cwd: root, isProjectTrusted: () => false };

  const first = loadSkillSettings(context);
  writeFileSync(settingsPath, JSON.stringify({ skillTweaks: { warmSkills: ["local"] } }));
  expect(loadSkillSettings(context)).toBe(first);
  expect(loadSkillSettings({ ...context }).global).toMatchObject({
    skillTweaks: { warmSkills: ["local"] },
  });
});
