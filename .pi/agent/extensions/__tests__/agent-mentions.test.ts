import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import agentMentions, {
  type AgentMention,
  agentMentionForegroundAnsi,
  agentMentionInstruction,
  findAgentMentions,
  formatAgentMentions,
  formatAnsiAgentMentions,
  loadAgentMentions,
} from "../agent-mentions";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-agent-mentions-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("agent mentions", () => {
  test("loads global agents and project overrides", () => {
    const root = temporaryDirectory();
    const agentDirectory = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(join(agentDirectory, "agents"), { recursive: true });
    mkdirSync(join(cwd, ".pi", "agents"), { recursive: true });
    writeFileSync(
      join(agentDirectory, "agents", "review.md"),
      '---\ndescription: Global reviewer\ncolor: "#a8d0e6"\n---\nReview globally.',
    );
    writeFileSync(
      join(cwd, ".pi", "agents", "review.md"),
      '---\ndescription: Project reviewer\ndisplay_name: Code Review\ncolor: "#123456"\n---\nReview this project.',
    );
    writeFileSync(join(cwd, ".pi", "agents", "Plan.md"), "---\nenabled: false\n---\nDisabled.");

    const mentions = loadAgentMentions(cwd, agentDirectory);

    expect(mentions.find((mention) => mention.name === "review")?.description).toBe(
      "Project reviewer",
    );
    expect(mentions.find((mention) => mention.name === "review")?.color).toBe("#123456");
    expect(mentions.find((mention) => mention.name === "review")?.displayName).toBe("Code Review");
    expect(mentions.some((mention) => mention.name === "Plan")).toBeFalse();
    expect(mentions.some((mention) => mention.name === "general-purpose")).toBeTrue();
  });

  test("matches known agents case-insensitively and only once", () => {
    const cwd = temporaryDirectory();
    const mentions: AgentMention[] = [
      { name: "explore", description: "Explore" },
      { name: "review", description: "Review" },
    ];

    expect(
      findAgentMentions("@Explore inspect this with @review and @explore", mentions, cwd),
    ).toEqual(mentions);
  });

  test("leaves unknown mentions and same-named paths alone", () => {
    const cwd = temporaryDirectory();
    writeFileSync(join(cwd, "explore"), "file");
    const mentions = [{ name: "explore", description: "Explore" }];

    expect(findAgentMentions("@unknown inspect this", mentions, cwd)).toEqual([]);
    expect(findAgentMentions("@explore inspect this", mentions, cwd)).toEqual([]);
  });

  test("builds an explicit tool-routing instruction", () => {
    expect(agentMentionInstruction([{ name: "explore", description: "Explore" }])).toContain(
      "exact subagent_type",
    );
  });

  test("colorizes mentions in plain terminal output", () => {
    const cwd = temporaryDirectory();
    const mentions = [{ name: "explore", description: "Explore", color: "#80a9c8" }];

    const formatted = formatAgentMentions(
      "Ask @explore to inspect this",
      mentions,
      cwd,
      (mention, text) => `${mention.color}:${text}`,
    );

    expect(formatted).toBe("Ask #80a9c8:@explore to inspect this");
  });

  test("uses the theme accent for agents without explicit color metadata", () => {
    const theme = {
      getFgAnsi: (color: string) => `<${color}>`,
    } as Theme;

    expect(agentMentionForegroundAnsi(theme, { name: "Explore", description: "Explore" })).toBe(
      "<accent>",
    );
  });

  test("preserves cursor escapes inside a colorized input mention", () => {
    const cwd = temporaryDirectory();
    const mentions = [{ name: "explore", description: "Explore", color: "#80a9c8" }];
    const color = "\u001b[38;2;128;169;200m";
    const input = "@ex\u001b[7mp\u001b[0mlore";

    const formatted = formatAnsiAgentMentions(input, mentions, cwd, () => color);

    expect(stripTerminalSequences(formatted)).toBe("@explore");
    expect(formatted.split(color)).toHaveLength(3);
  });

  test("adds the routing instruction only when the subagent tool is active", () => {
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
      getActiveTools: () => ["subagent"],
      registerMarkdownTransformer() {},
    } as unknown as ExtensionAPI;
    agentMentions(pi);

    const event = {
      type: "before_agent_start",
      prompt: "@explore inspect autocomplete",
      systemPrompt: "base prompt",
      systemPromptOptions: {},
    } as BeforeAgentStartEvent;
    const result = handler?.(event, { cwd: "/tmp" } as ExtensionContext);

    expect(result?.systemPrompt).toStartWith("base prompt\n\n");
    expect(result?.systemPrompt).toContain("@explore");
  });

  test("does not route mentions when the subagent tool is unavailable", () => {
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
      getActiveTools: () => ["read"],
      registerMarkdownTransformer() {},
    } as unknown as ExtensionAPI;
    agentMentions(pi);

    const result = handler?.(
      {
        type: "before_agent_start",
        prompt: "@explore inspect autocomplete",
        systemPrompt: "base prompt",
        systemPromptOptions: {},
      } as BeforeAgentStartEvent,
      { cwd: temporaryDirectory() } as ExtensionContext,
    );

    expect(result).toBeUndefined();
  });
});
