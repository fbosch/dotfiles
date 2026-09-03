import { readFileSync } from "node:fs";
import {
  type ExtensionAPI,
  type InputEvent,
  type InputEventResult,
  parseFrontmatter,
  type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const ROUTED_PROMPT_MESSAGE = "routed-prompt";
const SUBAGENTS_SERVICE_KEY = Symbol.for("@gotgenes/pi-subagents:service");

interface SpawnOptions {
  description?: string;
  model?: string;
  maxTurns?: number;
  thinkingLevel?: string;
  inheritContext?: boolean;
  foreground?: boolean;
}

interface SubagentsService {
  spawn(type: string, prompt: string, options?: SpawnOptions): string;
}

interface RoutedPromptFrontmatter extends Record<string, unknown> {
  agent?: unknown;
  inherit_context?: unknown;
  max_turns?: unknown;
  model?: unknown;
  thinking?: unknown;
  usage?: unknown;
}

export interface RoutedPrompt {
  agent: string;
  command: string;
  description: string;
  prompt: string;
  usage?: string;
  options: SpawnOptions;
}

interface RoutedPromptsDependencies {
  getSubagentsService?: () => SubagentsService | undefined;
  readPrompt?: (path: string) => string;
}

interface PromptInvocation {
  args: string[];
  command: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function optionalString(
  frontmatter: RoutedPromptFrontmatter,
  field: keyof RoutedPromptFrontmatter,
): string | undefined {
  const value = frontmatter[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${String(field)} must be a non-empty string`);
  }
  return value.trim();
}

function optionalBoolean(
  frontmatter: RoutedPromptFrontmatter,
  field: keyof RoutedPromptFrontmatter,
): boolean | undefined {
  const value = frontmatter[field];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${String(field)} must be a boolean`);
  return value;
}

function optionalPositiveInteger(
  frontmatter: RoutedPromptFrontmatter,
  field: keyof RoutedPromptFrontmatter,
): number | undefined {
  const value = frontmatter[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || Number.isInteger(value) === false || value < 1) {
    throw new Error(`${String(field)} must be a positive integer`);
  }
  return value;
}

export function parseCommandInvocation(text: string): PromptInvocation | undefined {
  const match = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (match === null) return undefined;
  const command = match[1];
  if (command === undefined) return undefined;
  return { command, args: parseCommandArgs(match[2] ?? "") };
}

// Keep routed templates aligned with Pi's native prompt argument syntax because input
// interception happens immediately before Pi would otherwise perform this expansion.
export function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;

  for (const character of argsString) {
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }

  if (current.length > 0) args.push(current);
  return args;
}

export function substitutePromptArgs(content: string, args: readonly string[]): string {
  const allArgs = args.join(" ");
  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (_match, defaultTarget, defaultValue, sliceStart, sliceLength, simple) => {
      if (defaultTarget !== undefined) {
        const value =
          defaultTarget === "@" || defaultTarget === "ARGUMENTS"
            ? allArgs
            : args[Number.parseInt(defaultTarget, 10) - 1];
        return value ? value : defaultValue;
      }
      if (sliceStart !== undefined) {
        const start = Math.max(Number.parseInt(sliceStart, 10) - 1, 0);
        if (sliceLength !== undefined) {
          const length = Number.parseInt(sliceLength, 10);
          return args.slice(start, start + length).join(" ");
        }
        return args.slice(start).join(" ");
      }
      if (simple === "ARGUMENTS" || simple === "@") return allArgs;
      return args[Number.parseInt(simple, 10) - 1] ?? "";
    },
  );
}

function routeOptions(
  command: SlashCommandInfo,
  frontmatter: RoutedPromptFrontmatter,
): SpawnOptions {
  const options: SpawnOptions = {
    description: command.description ?? `Run /${command.name}`,
    // Service spawns are asynchronous. Force background mode so pi-subagents owns
    // progress and completion delivery even when an agent file defaults to foreground.
    foreground: false,
  };
  const model = optionalString(frontmatter, "model");
  const thinkingLevel = optionalString(frontmatter, "thinking");
  const maxTurns = optionalPositiveInteger(frontmatter, "max_turns");
  const inheritContext = optionalBoolean(frontmatter, "inherit_context");

  if (model !== undefined) options.model = model;
  if (thinkingLevel !== undefined) options.thinkingLevel = thinkingLevel;
  if (maxTurns !== undefined) options.maxTurns = maxTurns;
  if (inheritContext !== undefined) options.inheritContext = inheritContext;
  return options;
}

export function resolveRoutedPrompt(
  text: string,
  commands: readonly SlashCommandInfo[],
  readPrompt: (path: string) => string = (path) => readFileSync(path, "utf8"),
): RoutedPrompt | undefined {
  const invocation = parseCommandInvocation(text);
  if (invocation === undefined) return undefined;

  const command = commands.find(
    (candidate) => candidate.source === "prompt" && candidate.name === invocation.command,
  );
  if (command === undefined) return undefined;

  const parsed = parseFrontmatter<RoutedPromptFrontmatter>(readPrompt(command.sourceInfo.path));
  if (isRecord(parsed.frontmatter) === false || parsed.frontmatter.agent === undefined) {
    return undefined;
  }

  const agent = optionalString(parsed.frontmatter, "agent");
  if (agent === undefined) return undefined;
  const usage = optionalString(parsed.frontmatter, "usage");

  return {
    agent,
    command: invocation.command,
    description: command.description ?? `Run /${invocation.command}`,
    prompt: substitutePromptArgs(parsed.body, invocation.args),
    ...(usage === undefined || invocation.args.length > 0 ? {} : { usage }),
    options: routeOptions(command, parsed.frontmatter),
  };
}

function getSubagentsService(): SubagentsService | undefined {
  // pi-subagents documents this Symbol.for key as its cross-extension service contract.
  // Importing the accessor is not viable because Pi isolates package module roots.
  return (globalThis as Record<symbol, unknown>)[SUBAGENTS_SERVICE_KEY] as
    | SubagentsService
    | undefined;
}

function renderMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content) === false) return "";
  return content
    .filter(
      (item): item is { type: "text"; text: string } =>
        isRecord(item) && item.type === "text" && typeof item.text === "string",
    )
    .map((item) => item.text)
    .join("\n");
}

export function createRoutedPromptsExtension(
  dependencies: RoutedPromptsDependencies = {},
): (pi: ExtensionAPI) => void {
  const readPrompt = dependencies.readPrompt ?? ((path: string) => readFileSync(path, "utf8"));
  const getService = dependencies.getSubagentsService ?? getSubagentsService;

  return (pi) => {
    pi.registerMessageRenderer(
      ROUTED_PROMPT_MESSAGE,
      (message) => new Text(renderMessageContent(message.content), 0, 0),
    );

    pi.on("input", (event: InputEvent, ctx): InputEventResult => {
      if (event.source === "extension") return { action: "continue" };

      let routedPrompt: RoutedPrompt | undefined;
      try {
        routedPrompt = resolveRoutedPrompt(event.text, pi.getCommands(), readPrompt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Cannot route prompt: ${message}`, "error");
        return { action: "handled" };
      }
      if (routedPrompt === undefined) return { action: "continue" };

      if ((event.images?.length ?? 0) > 0) {
        ctx.ui.notify(
          `Cannot run /${routedPrompt.command}: routed prompts do not support images.`,
          "error",
        );
        return { action: "handled" };
      }

      if (routedPrompt.usage !== undefined) {
        pi.sendMessage({
          customType: ROUTED_PROMPT_MESSAGE,
          content: routedPrompt.usage,
          display: true,
        });
        return { action: "handled" };
      }

      const service = getService();
      if (service === undefined) {
        ctx.ui.notify(
          `Cannot run /${routedPrompt.command}: the pi-subagents service is unavailable.`,
          "error",
        );
        return { action: "handled" };
      }

      try {
        service.spawn(routedPrompt.agent, routedPrompt.prompt, routedPrompt.options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Cannot run /${routedPrompt.command}: ${message}`, "error");
      }
      return { action: "handled" };
    });
  };
}

export default createRoutedPromptsExtension();
