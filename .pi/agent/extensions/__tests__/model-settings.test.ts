import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

const AGENT_DIR = new URL("../../", import.meta.url);
const REPO_ROOT = new URL("../../../../", import.meta.url);

const AGENT_NAMES = [
  ["adversarial", "adversarial"],
  ["analyze", "analyze"],
  ["backlog-planning", "backlog-planning"],
  ["benchmark", "benchmark"],
  ["commit", "commit"],
  ["debug", "debug"],
  ["docs", "docs"],
  ["explore", "explore"],
  ["general", "general"],
  ["ideate", "ideate"],
  ["lookup", "lookup"],
  ["patterns", "patterns"],
  ["pr-feedback", "pr-feedback"],
  ["quick", "quick"],
  ["refactor", "refactor"],
  ["research", "research"],
  ["review", "review"],
  ["spec", "spec"],
  ["test", "test"],
  ["tutor", "tutor"],
  ["validate", "validate"],
] as const;

interface OpenCodeAgentConfig {
  model?: string;
  reasoningEffort?: string;
}

interface OpenCodeConfig {
  model: string;
  agent: Record<string, OpenCodeAgentConfig>;
}

interface PiSettings {
  defaultProvider: string;
  defaultModel: string;
  compactionModel: {
    model: string;
    thinkingLevel: string;
  };
  commitMessageModel: {
    model: string;
    thinkingLevel: string;
  };
}

interface PiModes {
  build: {
    model: string;
    thinkingLevel: string;
  };
  plan: {
    model: string;
    thinkingLevel: string;
  };
}

interface AutoSessionNameConfig {
  provider: string;
  model: string;
  reasoning: string;
  temperature?: number;
}

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

function toPiModel(model: string): string {
  return model.replace(/^openai\//, "openai-codex/");
}

function toPiThinking(level: string | undefined): string | undefined {
  return level === "none" ? "off" : level;
}

function required(value: unknown, setting: string): string {
  if (typeof value !== "string") throw new Error(`Missing string setting: ${setting}`);
  return value;
}

function requiredThinking(value: unknown, setting: string): string {
  const thinking = toPiThinking(typeof value === "string" ? value : undefined);
  if (thinking === undefined) throw new Error(`Missing reasoning setting: ${setting}`);
  return thinking;
}

describe("Pi model settings", () => {
  const openCode = readJson<OpenCodeConfig>(new URL(".config/opencode/opencode.jsonc", REPO_ROOT));
  const settings = readJson<PiSettings>(new URL("settings.json", AGENT_DIR));
  const modes = readJson<PiModes>(new URL("modes.json", AGENT_DIR));
  const autoSessionName = readJson<AutoSessionNameConfig>(
    new URL("extensions/auto-session-name.json", AGENT_DIR),
  );

  test("matches primary, build, plan, and compaction settings", () => {
    expect(`${settings.defaultProvider}/${settings.defaultModel}`).toBe(toPiModel(openCode.model));
    expect(modes.build.model).toBe(toPiModel(openCode.model));
    expect(modes.build.thinkingLevel).toBe(
      required(openCode.agent.build?.reasoningEffort, "agent.build.reasoningEffort"),
    );
    expect(modes.plan.model).toBe(toPiModel(openCode.agent.plan?.model ?? openCode.model));
    expect(modes.plan.thinkingLevel).toBe(
      required(openCode.agent.plan?.reasoningEffort, "agent.plan.reasoningEffort"),
    );
    expect(settings.compactionModel.model).toBe(
      toPiModel(openCode.agent.compaction?.model ?? openCode.model),
    );
    expect(settings.compactionModel.thinkingLevel).toBe(
      required(openCode.agent.compaction?.reasoningEffort, "agent.compaction.reasoningEffort"),
    );
  });

  test("matches the commit message model setting", () => {
    expect(settings.commitMessageModel.model).toBe(
      toPiModel(openCode.agent.commit?.model ?? openCode.model),
    );
    expect(settings.commitMessageModel.thinkingLevel).toBe(
      requiredThinking(openCode.agent.commit?.reasoningEffort, "agent.commit.reasoningEffort"),
    );
  });

  test("matches the automatic session title settings", () => {
    const title = openCode.agent.title;
    expect(`${autoSessionName.provider}/${autoSessionName.model}`).toBe(
      toPiModel(title?.model ?? openCode.model),
    );
    expect(autoSessionName.reasoning).toBe(
      requiredThinking(title?.reasoningEffort, "agent.title.reasoningEffort"),
    );
  });

  test("omits the unsupported Codex title temperature", () => {
    expect(autoSessionName.provider).toBe("openai-codex");
    expect(autoSessionName.temperature).toBeUndefined();
  });

  test.each(AGENT_NAMES)("matches the %s subagent", (piName, openCodeName) => {
    const source = openCode.agent[openCodeName];
    const content = readFileSync(new URL(`agents/${piName}.md`, AGENT_DIR), "utf8");
    const { frontmatter } = parseFrontmatter(content);

    expect(required(frontmatter.model, `agents/${piName}.md model`)).toBe(
      toPiModel(source?.model ?? openCode.model),
    );
    expect(requiredThinking(frontmatter.thinking, `agents/${piName}.md thinking`)).toBe(
      requiredThinking(source?.reasoningEffort, `agent.${openCodeName}.reasoningEffort`),
    );
  });
});
