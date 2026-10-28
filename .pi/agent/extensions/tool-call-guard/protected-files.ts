import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type ExtensionContext,
  getAgentDir,
  type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { canonicalPath } from "../../lib/nono-access";
import { isRecord } from "../shared/is-record";
import { catastrophicCommandReason } from "./catastrophic-commands";
import { executableWords, parseShell } from "./shell";

type BlockedCall = { block: true; reason: string };
const block = (reason: string): BlockedCall => ({ block: true, reason });
const MUTATIONS = new Set([
  "write",
  "edit",
  "replace",
  "replace_match",
  "insert",
  "copy",
  "move",
  "undo_last_change",
]);
const READ_ONLY = new Set([
  "cat",
  "ls",
  "pwd",
  "rg",
  "grep",
  "head",
  "tail",
  "wc",
  "echo",
  "printf",
  "true",
  "false",
]);
const within = (root: string, path: string) => {
  const suffix = relative(root, path);
  return suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
};

export function protectedGuardPaths(cwd: string): readonly string[] {
  return [
    // The extension directory includes the catastrophic-command hard blocks.
    import.meta.dir,
    join(getAgentDir(), "settings.json"),
    join(cwd, ".pi", "settings.json"),
  ];
}

async function anchorPaths(event: ToolCallEvent, ctx: ExtensionContext): Promise<string[]> {
  // Use the same session-scoped registry as the installed hashline tools. The
  // declared path alone does not identify a cross-file copy/move destination.
  const modulePath = join(
    getAgentDir(),
    "npm/node_modules/pi-hashline-edit-pro/src/anchor-registry.ts",
  );
  const registry: unknown = await import(pathToFileURL(modulePath).href);
  if (
    !isRecord(registry) ||
    typeof registry.withAnchorSession !== "function" ||
    typeof registry.ownerOf !== "function"
  )
    throw new Error("Hashline ownership unavailable");
  const withSession = registry.withAnchorSession;
  const ownerOf = registry.ownerOf;
  const paths: unknown = await withSession(ctx, () => {
    const input: unknown = event.input;
    if (!isRecord(input)) throw new Error("Invalid tool input");
    const owners: string[] = [];
    for (const key of ["source_from", "source_to", "anchor"]) {
      const anchor = input[key];
      if (typeof anchor !== "string") throw new Error("Missing hashline anchor");
      const owner: unknown = ownerOf(anchor);
      if (!isRecord(owner) || typeof owner.path !== "string")
        throw new Error("Unknown hashline anchor");
      owners.push(owner.path);
    }
    return owners;
  });
  if (!Array.isArray(paths) || !paths.every((path): path is string => typeof path === "string"))
    throw new Error("Invalid hashline ownership");
  return paths;
}

interface ProtectionOptions {
  enqueue: (task: () => Promise<BlockedCall | undefined>) => Promise<BlockedCall | undefined>;
  paths?: readonly string[];
  resolveAnchors?: typeof anchorPaths;
}

export function createGuardProtection(options: ProtectionOptions) {
  const pending = new Set<AbortController>();
  let generation = 0;
  const cancel = () => {
    generation++;
    for (const controller of pending) controller.abort();
    pending.clear();
  };
  const targets = (event: ToolCallEvent): string[] | undefined => {
    if (MUTATIONS.has(event.toolName)) {
      const input: unknown = event.input;
      return isRecord(input) && typeof input.path === "string" ? [input.path] : [];
    }
    if (event.toolName !== "bash" || typeof event.input.command !== "string") return undefined;
    const parsed = parseShell(event.input.command);
    if (parsed.kind === "unknown") {
      // shortcut: opaque code cannot yield exact mutation targets. Its execution
      // remains the configured command guard's responsibility, not a sandbox guarantee.
      return undefined;
    }
    const paths: string[] = [];
    for (const command of parsed.commands) {
      paths.push(
        ...command.redirects
          .filter((redir) => redir.operator !== "<")
          .map((redir) => redir.target.value),
      );
      const words = executableWords(command.words) ?? command.words;
      const executable = words[0]?.value.split("/").at(-1) ?? "";
      if (READ_ONLY.has(executable)) continue;
      paths.push(...words.slice(1).map((word) => word.value.replace(/^[^=]+=/, "")));
    }
    return paths;
  };
  const resolveTargets = (paths: readonly string[], cwd: string) =>
    paths.map((path) => {
      const expanded =
        path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
      const canonical = canonicalPath(cwd, expanded);
      if (!canonical) throw new Error("Unresolved mutation path");
      return canonical;
    });
  const relevant = (paths: readonly string[], cwd: string) => {
    const roots = resolveTargets(options.paths ?? protectedGuardPaths(cwd), cwd);
    return paths.filter((path) => roots.some((root) => within(root, path) || within(path, root)));
  };
  const review = async (
    event: ToolCallEvent,
    ctx: ExtensionContext,
    initial: string[],
  ): Promise<BlockedCall | undefined> => {
    const cwd = ctx.cwd;
    const currentGeneration = generation;
    const snapshot = JSON.stringify(event.input);
    const controller = new AbortController();
    pending.add(controller);
    const onAbort = () => controller.abort();
    ctx.signal?.addEventListener("abort", onAbort, { once: true });
    const state = () => {
      if (controller.signal.aborted || ctx.signal?.aborted || generation !== currentGeneration)
        return block("Command guard file approval was cancelled.");
      if (cwd !== ctx.cwd || snapshot !== JSON.stringify(event.input))
        return block("Tool input changed during command guard file approval.");
      if (event.toolName === "bash" && typeof event.input.command === "string") {
        const reason = catastrophicCommandReason(event.input.command);
        if (reason) return block(reason);
      }
      return undefined;
    };
    const currentPaths = async () =>
      resolveTargets(
        [
          ...initial,
          ...(event.toolName === "copy" || event.toolName === "move"
            ? await (options.resolveAnchors ?? anchorPaths)(event, ctx)
            : []),
        ],
        cwd,
      );
    try {
      const before = state();
      if (before) return before;
      const paths = await currentPaths();
      const protectedPaths = relevant(paths, cwd);
      if (!protectedPaths.length) return;
      if (!ctx.hasUI) return block("Changing command guard files requires interactive approval.");
      return await options.enqueue(async () => {
        const beforePrompt = state();
        if (beforePrompt) return beforePrompt;
        const approved = await ctx.ui.confirm(
          "Change command guard files?",
          `Tool: ${JSON.stringify(event.toolName)}\nProtected paths:\n${protectedPaths.map((path) => JSON.stringify(path)).join("\n")}\nInput: ${snapshot}\nApproval applies only to this tool call.`,
          { signal: controller.signal },
        );
        const after = state();
        if (after) return after;
        if (JSON.stringify(paths) !== JSON.stringify(await currentPaths()))
          return block("Mutation targets changed during command guard file approval.");
        return approved ? undefined : block("Command guard file change was not approved.");
      });
    } catch {
      return block("Command guard mutation targets could not be verified.");
    } finally {
      ctx.signal?.removeEventListener("abort", onAbort);
      pending.delete(controller);
    }
  };
  return {
    cancel,
    check(
      event: ToolCallEvent,
      ctx: ExtensionContext,
    ): Promise<BlockedCall | undefined> | undefined {
      if (options.paths?.length === 0) return undefined;
      const paths = targets(event);
      if (paths === undefined) return undefined;
      if (event.toolName === "copy" || event.toolName === "move") return review(event, ctx, paths);
      try {
        const resolved = resolveTargets(paths, ctx.cwd);
        if (!relevant(resolved, ctx.cwd).length) return undefined;
      } catch {
        return Promise.resolve(block("Command guard mutation targets could not be verified."));
      }
      return review(event, ctx, paths);
    },
  };
}
