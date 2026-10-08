import { existsSync, readdirSync, readFileSync, watch } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  parseFrontmatter,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { hexForegroundAnsi } from "../prompt-ui/terminal-color";
import {
  type ReferencePathState,
  resolveReferencePath,
} from "./project-references/reference-mentions";

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

function applyAgentMentionFile(
  file: string,
  contents: string,
  mentions: Map<string, AgentMention>,
): void {
  const name = basename(file, ".md");
  const { frontmatter } = parseFrontmatter(contents);
  if (frontmatter.enabled === false) {
    mentions.delete(name.toLowerCase());
    return;
  }

  const description = typeof frontmatter.description === "string" ? frontmatter.description : name;
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
      applyAgentMentionFile(file, readFileSync(join(directory, file), "utf8"), mentions);
    } catch {}
  }
}

export function loadAgentMentions(
  cwd: string,
  agentDirectory = getAgentDir(),
  includeProjectAgents = true,
): AgentMention[] {
  const mentions = new Map(
    BUILTIN_AGENT_MENTIONS.map((mention) => [mention.name.toLowerCase(), mention]),
  );
  loadAgentDirectory(join(agentDirectory, "agents"), mentions);
  if (includeProjectAgents) {
    loadAgentDirectory(join(cwd, CONFIG_DIR_NAME, "agents"), mentions);
  }
  return [...mentions.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export interface AgentMentionCacheFileSystem {
  readDirectory(directory: string): Promise<string[]>;
  readText(path: string): Promise<string>;
  isDirectory(path: string): Promise<boolean>;
  pathIdentity(path: string): Promise<string | undefined>;
  pathIsFile(path: string): Promise<boolean>;
  watchDirectory(path: string, onChange: () => void): () => void;
}

const DEFAULT_AGENT_MENTION_FILESYSTEM: AgentMentionCacheFileSystem = {
  readDirectory: (directory) => readdir(directory, { encoding: "utf8" }),
  readText: (path) => readFile(path, "utf8"),
  isDirectory: async (path) => {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  },
  pathIdentity: async (path) => {
    try {
      const identity = await stat(path);
      return `${identity.dev}:${identity.ino}`;
    } catch {
      return undefined;
    }
  },
  pathIsFile: async (path) => {
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  },
  watchDirectory: (path, onChange) => {
    const watcher = watch(path, onChange);
    watcher.on("error", onChange);
    return () => watcher.close();
  },
};

export class AgentMentionCache {
  readonly cwd: string;
  readonly includeProjectAgents: boolean;
  private readonly globalAgentDirectory: string;
  private readonly fileSystem: AgentMentionCacheFileSystem;
  private mentions = [...BUILTIN_AGENT_MENTIONS];
  private shadowedPaths = new Set<string>();
  private readonly watchers = new Map<string, () => void>();
  private caseInsensitivePaths = new Set<string>();
  private readonly referencePaths = new Map<string, ReferencePathState>();
  private readonly listeners = new Set<() => void>();
  private refreshTask: Promise<void> | undefined;
  private refreshRequested = false;
  private started = false;
  private disposed = false;
  private currentVersion = 0;

  constructor(
    cwd: string,
    globalAgentDirectory = getAgentDir(),
    includeProjectAgents = true,
    fileSystem = DEFAULT_AGENT_MENTION_FILESYSTEM,
  ) {
    this.cwd = cwd;
    this.globalAgentDirectory = globalAgentDirectory;
    this.includeProjectAgents = includeProjectAgents;
    this.fileSystem = fileSystem;
  }

  get version(): number {
    return this.currentVersion;
  }

  getMentions(): readonly AgentMention[] {
    return this.mentions;
  }

  isPathShadowed(name: string): boolean {
    return this.shadowedPaths.has(name) || this.caseInsensitivePaths.has(name.toLowerCase());
  }

  referencePathState(value: string): ReferencePathState {
    const path = resolveReferencePath(value, this.cwd);
    let state = this.referencePaths.get(path);
    if (state === undefined) {
      state = { exists: false, isFile: false };
      if (!this.disposed) {
        this.referencePaths.set(path, state);
        if (this.started) void this.queueRefresh();
      }
    }
    return state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.started || this.disposed) return this.refreshTask ?? Promise.resolve();
    this.started = true;
    return this.queueRefresh();
  }
  refresh(): Promise<void> {
    return this.queueRefresh();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const close of this.watchers.values()) close();
    this.watchers.clear();
    this.listeners.clear();
  }

  private queueRefresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.refreshRequested = true;
    if (this.refreshTask !== undefined) return this.refreshTask;

    this.refreshTask = this.refreshUntilCurrent().finally(() => {
      this.refreshTask = undefined;
      if (this.refreshRequested && this.disposed === false) void this.queueRefresh();
    });
    return this.refreshTask;
  }

  private async refreshUntilCurrent(): Promise<void> {
    while (this.refreshRequested && this.disposed === false) {
      this.refreshRequested = false;
      try {
        await this.refreshMetadata();
      } catch {
        // Missing or temporarily unreadable agent directories are treated as empty, as before.
      }
    }
  }

  private async refreshMetadata(): Promise<void> {
    await this.updateWatchers();
    const mentions = new Map(
      BUILTIN_AGENT_MENTIONS.map((mention) => [mention.name.toLowerCase(), mention]),
    );
    await this.loadDirectory(join(this.globalAgentDirectory, "agents"), mentions);
    if (this.includeProjectAgents) {
      await this.loadDirectory(join(this.cwd, CONFIG_DIR_NAME, "agents"), mentions);
    }

    const shadowedPaths = new Set<string>();
    const caseInsensitivePaths = new Set<string>();
    const entries = await this.fileSystem.readDirectory(this.cwd).catch(() => []);
    await Promise.all(
      entries
        .filter((name) => mentions.has(name.toLowerCase()))
        .map(async (name) => {
          const identity = await this.fileSystem.pathIdentity(join(this.cwd, name));
          if (identity === undefined) return;
          shadowedPaths.add(name);
          // Detect aliases per path rather than guessing filesystem case sensitivity from the OS.
          const alternate = name.replace(/[a-z]/i, (letter) =>
            letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase(),
          );
          if (
            alternate !== name &&
            (await this.fileSystem.pathIdentity(join(this.cwd, alternate))) === identity
          ) {
            caseInsensitivePaths.add(name.toLowerCase());
          }
        }),
    );
    let pathsChanged = false;
    const referenceStates = await Promise.all(
      [...this.referencePaths].map(async ([path, previous]) => {
        const exists = (await this.fileSystem.pathIdentity(path)) !== undefined;
        const isFile = exists && (await this.fileSystem.pathIsFile(path));
        pathsChanged ||= exists !== previous.exists || isFile !== previous.isFile;
        return [path, { exists, isFile }] as const;
      }),
    );
    const sortedMentions = [...mentions.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    if (
      !pathsChanged &&
      JSON.stringify(sortedMentions) === JSON.stringify(this.mentions) &&
      sameSet(shadowedPaths, this.shadowedPaths) &&
      sameSet(caseInsensitivePaths, this.caseInsensitivePaths)
    ) {
      return;
    }

    if (this.disposed) return;
    for (const [path, state] of referenceStates) this.referencePaths.set(path, state);
    this.mentions = sortedMentions;
    this.shadowedPaths = shadowedPaths;
    this.caseInsensitivePaths = caseInsensitivePaths;
    this.currentVersion += 1;
    for (const listener of this.listeners) listener();
  }

  private async loadDirectory(
    directory: string,
    mentions: Map<string, AgentMention>,
  ): Promise<void> {
    let files: string[];
    try {
      files = (await this.fileSystem.readDirectory(directory)).filter((file) =>
        file.endsWith(".md"),
      );
    } catch {
      return;
    }

    for (const file of files) {
      try {
        applyAgentMentionFile(
          file,
          await this.fileSystem.readText(join(directory, file)),
          mentions,
        );
      } catch {}
    }
  }

  private async updateWatchers(): Promise<void> {
    const targets = [
      this.cwd,
      join(this.globalAgentDirectory, "agents"),
      ...(this.includeProjectAgents ? [join(this.cwd, CONFIG_DIR_NAME, "agents")] : []),
      ...[...this.referencePaths.keys()].map((path) => dirname(path)),
    ];
    const desired = new Set(
      (
        await Promise.all(
          targets
            .flatMap((target) => [target, dirname(target)])
            .map((target) => this.findWatchableAncestor(target)),
        )
      ).filter((directory): directory is string => directory !== undefined),
    );

    if (this.disposed) return;
    for (const [directory, close] of this.watchers) {
      if (desired.has(directory)) continue;
      close();
      this.watchers.delete(directory);
    }
    for (const directory of desired) {
      if (this.watchers.has(directory)) continue;
      try {
        this.watchers.set(
          directory,
          this.fileSystem.watchDirectory(directory, () => {
            // Directory watches follow inodes; re-arm after renames or atomic replacements.
            for (const close of this.watchers.values()) close();
            this.watchers.clear();
            void this.queueRefresh();
          }),
        );
      } catch {}
    }
  }

  private async findWatchableAncestor(path: string): Promise<string | undefined> {
    let directory = path;
    while (true) {
      if (await this.fileSystem.isDirectory(directory)) return directory;
      const parent = dirname(directory);
      if (parent === directory) return undefined;
      directory = parent;
    }
  }
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
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
  isPathShadowed: (name: string) => boolean,
): AgentMentionMatch[] {
  const availableByName = new Map(
    availableMentions.map((mention) => [mention.name.toLowerCase(), mention]),
  );
  const matches: AgentMentionMatch[] = [];

  for (const match of text.matchAll(AGENT_MENTION_PATTERN)) {
    const requestedName = match[2];
    if (requestedName === undefined || isPathShadowed(requestedName)) continue;

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
  isPathShadowed = (name: string) => pathShadowsAgentMention(name, cwd),
): AgentMention[] {
  const matched = new Map<string, AgentMention>();

  for (const { mention } of matchAgentMentions(text, availableMentions, isPathShadowed)) {
    matched.set(mention.name.toLowerCase(), mention);
  }

  return [...matched.values()];
}

export function formatAgentMentions(
  text: string,
  availableMentions: readonly AgentMention[],
  cwd: string,
  format: (mention: AgentMention, text: string) => string,
  isPathShadowed = (name: string) => pathShadowsAgentMention(name, cwd),
): string {
  let formatted = text;
  const matches = matchAgentMentions(text, availableMentions, isPathShadowed);
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
  isPathShadowed = (name: string) => pathShadowsAgentMention(name, cwd),
): string {
  const { plain, boundaries } = plainTextBoundaries(text);
  let formatted = text;
  const matches = matchAgentMentions(plain, availableMentions, isPathShadowed);

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
    "This selection applies only to the current user request, not later requests.",
    "For each invoked agent, use the user message and context to create a focused prompt, then call the subagent tool with that exact subagent_type.",
    "Do not handle the delegated task directly or substitute another agent.",
    "</explicit-subagent-invocation>",
  ].join("\n");
}

export default function agentMentions(pi: ExtensionAPI): void {
  let activeContext: ExtensionContext | undefined;
  let activeCache: AgentMentionCache | undefined;
  pi.on("session_start", async (_event, ctx) => {
    activeCache?.dispose();
    activeContext = ctx;
    activeCache = new AgentMentionCache(ctx.cwd, getAgentDir(), ctx.isProjectTrusted?.() ?? false);
    activeCache.subscribe(() => pi.events.emit("dotfiles:mentions-changed", undefined));
    await activeCache.start();
  });
  pi.on("session_shutdown", () => {
    activeContext = undefined;
    activeCache?.dispose();
    activeCache = undefined;
  });
  pi.registerMarkdownTransformer((markdown, renderContext) => {
    if (
      renderContext.messageType !== "user" ||
      activeContext === undefined ||
      activeCache === undefined
    ) {
      return markdown;
    }

    const theme = activeContext.ui.theme;
    return formatAgentMentions(
      markdown,
      activeCache.getMentions(),
      activeContext.cwd,
      (mention, text) =>
        `${agentMentionForegroundAnsi(theme, mention)}${text}${theme.getFgAnsi("userMessageText")}`,
      (name) => activeCache?.isPathShadowed(name) ?? false,
    );
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (pi.getActiveTools().includes("subagent") === false) return;

    const includeProjectAgents = ctx.isProjectTrusted?.() ?? false;
    const cache =
      activeCache?.cwd === ctx.cwd && activeCache.includeProjectAgents === includeProjectAgents
        ? activeCache
        : undefined;
    await cache?.refresh();
    const mentions = findAgentMentions(
      event.prompt,
      cache?.getMentions() ?? loadAgentMentions(ctx.cwd, getAgentDir(), includeProjectAgents),
      ctx.cwd,
      cache === undefined
        ? (name) => pathShadowsAgentMention(name, ctx.cwd)
        : (name) => cache.isPathShadowed(name),
    );
    if (mentions.length === 0) return;

    return {
      message: {
        customType: "explicit-subagent-invocation",
        content: agentMentionInstruction(mentions),
        display: false,
        details: { agents: mentions.map((mention) => mention.name) },
      },
    };
  });
}
