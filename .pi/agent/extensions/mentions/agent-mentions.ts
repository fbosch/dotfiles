import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  parseFrontmatter,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { hexForegroundAnsi } from "../prompt-ui/terminal-color";

export interface AgentMention {
  name: string;
  description: string;
  color?: string;
  displayName?: string;
}

const BUILTIN_AGENT_MENTIONS: readonly AgentMention[] = [
  {
    name: "general",
    description: "General-purpose agent for complex, multi-step tasks",
  },
  {
    name: "Explore",
    description: "Read-only codebase explorer",
  },
  {
    name: "Plan",
    description: "Creates implementation plans",
  },
];
const AGENT_MENTION_PATTERN = /(^|\s)@([a-z0-9][a-z0-9-]*)(?=\s|$)/gi;
const ESCAPE = String.fromCharCode(27);
const BELL = String.fromCharCode(7);
// Biome rejects control characters in regex literals, so build the ANSI matcher from code points.
const TERMINAL_SEQUENCE_PATTERN = new RegExp(
  `${ESCAPE}(?:\\][^${BELL}]*(?:${BELL}|${ESCAPE}\\\\)|\\[[0-?]*[ -/]*[@-~])`,
  "g",
);
const FOREGROUND_RESET_PATTERN = new RegExp(`${ESCAPE}\\[(?:0|39)?m`, "g");

interface AgentMentionMatch {
  mention: AgentMention;
  start: number;
  end: number;
}

function loadAgentDirectory(directory: string, mentions: Map<string, AgentMention>): void {
  let files: string[];
  try {
    files = readdirSync(directory).filter((file) => file.endsWith(".md"));
  } catch {
    return;
  }

  for (const file of files) {
    try {
      const name = basename(file, ".md");
      const { frontmatter } = parseFrontmatter(readFileSync(join(directory, file), "utf8"));
      if (frontmatter.enabled === false) {
        mentions.delete(name.toLowerCase());
        continue;
      }

      const description =
        typeof frontmatter.description === "string" ? frontmatter.description : name;
      const color =
        typeof frontmatter.color === "string" && /^#[0-9a-f]{6}$/i.test(frontmatter.color)
          ? frontmatter.color
          : undefined;
      const displayName =
        typeof frontmatter.display_name === "string" && frontmatter.display_name.trim().length > 0
          ? frontmatter.display_name.trim()
          : undefined;
      mentions.set(name.toLowerCase(), {
        name,
        description,
        ...(color === undefined ? {} : { color }),
        ...(displayName === undefined ? {} : { displayName }),
      });
    } catch {}
  }
}

export function loadAgentMentions(cwd: string, agentDirectory = getAgentDir()): AgentMention[] {
  const mentions = new Map(
    BUILTIN_AGENT_MENTIONS.map((mention) => [mention.name.toLowerCase(), mention]),
  );
  loadAgentDirectory(join(agentDirectory, "agents"), mentions);
  loadAgentDirectory(join(cwd, CONFIG_DIR_NAME, "agents"), mentions);
  return [...mentions.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function pathShadowsAgentMention(name: string, cwd: string): boolean {
  return existsSync(resolve(cwd, name));
}

export function agentMentionForegroundAnsi(theme: Theme, mention: AgentMention): string {
  return mention.color === undefined
    ? theme.getFgAnsi("accent")
    : hexForegroundAnsi(theme, mention.color);
}

function matchAgentMentions(
  text: string,
  availableMentions: readonly AgentMention[],
  cwd: string,
): AgentMentionMatch[] {
  const availableByName = new Map(
    availableMentions.map((mention) => [mention.name.toLowerCase(), mention]),
  );
  const matches: AgentMentionMatch[] = [];

  for (const match of text.matchAll(AGENT_MENTION_PATTERN)) {
    const requestedName = match[2];
    if (requestedName === undefined || pathShadowsAgentMention(requestedName, cwd)) continue;

    const mention = availableByName.get(requestedName.toLowerCase());
    if (mention === undefined) continue;

    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    matches.push({ mention, start, end: start + requestedName.length + 1 });
  }

  return matches;
}

export function findAgentMentions(
  text: string,
  availableMentions: readonly AgentMention[],
  cwd: string,
): AgentMention[] {
  const matched = new Map<string, AgentMention>();

  for (const { mention } of matchAgentMentions(text, availableMentions, cwd)) {
    matched.set(mention.name.toLowerCase(), mention);
  }

  return [...matched.values()];
}

export function formatAgentMentions(
  text: string,
  availableMentions: readonly AgentMention[],
  cwd: string,
  format: (mention: AgentMention, text: string) => string,
): string {
  let formatted = text;
  const matches = matchAgentMentions(text, availableMentions, cwd);
  for (const match of matches.reverse()) {
    formatted =
      formatted.slice(0, match.start) +
      format(match.mention, text.slice(match.start, match.end)) +
      formatted.slice(match.end);
  }
  return formatted;
}

function plainTextBoundaries(text: string): { plain: string; boundaries: number[] } {
  let plain = "";
  let rawOffset = 0;
  const boundaries = [0];

  const appendPlain = (segment: string) => {
    for (const character of segment) {
      boundaries[plain.length] = rawOffset;
      plain += character;
      rawOffset += character.length;
      boundaries[plain.length] = rawOffset;
    }
  };

  for (const sequence of text.matchAll(TERMINAL_SEQUENCE_PATTERN)) {
    const sequenceStart = sequence.index ?? rawOffset;
    appendPlain(text.slice(rawOffset, sequenceStart));
    rawOffset = sequenceStart + sequence[0].length;
  }
  appendPlain(text.slice(rawOffset));

  return { plain, boundaries };
}

export function formatAnsiAgentMentions(
  text: string,
  availableMentions: readonly AgentMention[],
  cwd: string,
  foregroundAnsi: (mention: AgentMention) => string | undefined,
  restoreAnsi = "\u001b[39m",
): string {
  const { plain, boundaries } = plainTextBoundaries(text);
  let formatted = text;
  const matches = matchAgentMentions(plain, availableMentions, cwd);

  for (const match of matches.reverse()) {
    const color = foregroundAnsi(match.mention);
    const rawStart = boundaries[match.start];
    const rawEnd = boundaries[match.end];
    if (color === undefined || rawStart === undefined || rawEnd === undefined) continue;

    const mentionText = text
      .slice(rawStart, rawEnd)
      .replace(FOREGROUND_RESET_PATTERN, (reset) => `${reset}${color}`);
    formatted =
      formatted.slice(0, rawStart) + color + mentionText + restoreAnsi + formatted.slice(rawEnd);
  }

  return formatted;
}

export function agentMentionInstruction(mentions: readonly AgentMention[]): string {
  const names = mentions.map((mention) => `@${mention.name}`).join(", ");
  return [
    "<explicit-subagent-invocation>",
    `The user explicitly invoked ${names}.`,
    "For each invoked agent, use the user message and context to create a focused prompt, then call the subagent tool with that exact subagent_type.",
    "Do not handle the delegated task directly or substitute another agent.",
    "</explicit-subagent-invocation>",
  ].join("\n");
}

export default function agentMentions(pi: ExtensionAPI): void {
  let activeContext: ExtensionContext | undefined;
  pi.on("session_start", (_event, ctx) => {
    activeContext = ctx;
  });
  pi.on("session_shutdown", () => {
    activeContext = undefined;
  });
  pi.registerMarkdownTransformer((markdown, renderContext) => {
    if (renderContext.messageType !== "user" || activeContext === undefined) return markdown;

    const theme = activeContext.ui.theme;
    const mentions = loadAgentMentions(activeContext.cwd);
    return formatAgentMentions(
      markdown,
      mentions,
      activeContext.cwd,
      (mention, text) =>
        `${agentMentionForegroundAnsi(theme, mention)}${text}${theme.getFgAnsi("userMessageText")}`,
    );
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (pi.getActiveTools().includes("subagent") === false) return;

    const mentions = findAgentMentions(event.prompt, loadAgentMentions(ctx.cwd), ctx.cwd);
    if (mentions.length === 0) return;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${agentMentionInstruction(mentions)}`,
    };
  });
}
