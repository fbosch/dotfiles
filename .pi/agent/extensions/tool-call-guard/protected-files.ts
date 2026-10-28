import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type ExtensionContext,
  getAgentDir,
  type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { canonicalPath } from "../../lib/nono-access";
import { confirmCommandPermission } from "../prompt-ui/command-permission";
import { isRecord } from "../shared/is-record";
import { catastrophicCommandReason } from "./catastrophic-commands";
import { bashMutationTargets, type MutationTarget } from "./mutation-targets";

type BlockedCall = { block: true; reason: string };
const block = (reason: string): BlockedCall => ({ block: true, reason });
const FILE_MUTATIONS = new Set([
  "write",
  "edit",
  "replace",
  "replace_match",
  "insert",
  "copy",
  "move",
  "undo_last_change",
]);
const within = (root: string, path: string) => {
  const suffix = relative(root, path);
  return suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
};
const expandHome = (path: string) =>
  path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;

export function protectedGuardPaths(cwd: string): readonly string[] {
  return [
    // The extension directory includes the catastrophic-command hard blocks.
    dirname(fileURLToPath(import.meta.url)),
    join(getAgentDir(), "settings.json"),
    join(cwd, ".pi", "settings.json"),
  ];
}

/**
 * Returns the files that own a copy/move call's anchors. Anchors the registry does not
 * know are skipped: the hashline tool rejects them itself, so they cannot reach a file.
 */
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
    throw new Error("Hashline anchor registry unavailable");
  const withSession = registry.withAnchorSession;
  const ownerOf = registry.ownerOf;
  const paths: unknown = await withSession(ctx, () => {
    const input: unknown = event.input;
    const owners: string[] = [];
    if (!isRecord(input)) return owners;
    for (const key of ["source_from", "source_to", "anchor"]) {
      const anchor = input[key];
      const owner: unknown = typeof anchor === "string" ? ownerOf(anchor) : undefined;
      if (isRecord(owner) && typeof owner.path === "string") owners.push(owner.path);
    }
    return owners;
  });
  if (!Array.isArray(paths) || !paths.every((path): path is string => typeof path === "string"))
    throw new Error("Hashline anchor registry returned invalid ownership");
  return paths;
}

interface ProtectionOptions {
  enqueue: (task: () => Promise<BlockedCall | undefined>) => Promise<BlockedCall | undefined>;
  paths?: readonly string[];
  resolveAnchors?: typeof anchorPaths;
}

/** What a call may change: resolved protected paths and targets that could not be resolved. */
interface Assessment {
  protectedPaths: string[];
  unresolved: boolean;
}

export function createGuardProtection(options: ProtectionOptions) {
  const pending = new Set<AbortController>();
  let generation = 0;
  const cancel = () => {
    generation++;
    for (const controller of pending) controller.abort();
    pending.clear();
  };

  // Bash targets come only from commands whose semantics name mutation operands.
  // Opaque commands (substitutions, scripts, inline code) yield `undefined`; their
  // execution is command review's responsibility, not this gate's.
  const directTargets = (event: ToolCallEvent, cwd: string): MutationTarget[] | undefined => {
    const input: unknown = event.input;
    if (FILE_MUTATIONS.has(event.toolName)) {
      return isRecord(input) && typeof input.path === "string"
        ? [{ path: input.path, cwds: [cwd] }]
        : [];
    }
    if (event.toolName !== "bash" || !isRecord(input) || typeof input.command !== "string")
      return undefined;
    return bashMutationTargets(input.command, cwd);
  };

  const assess = async (
    event: ToolCallEvent,
    ctx: ExtensionContext,
    cwd: string,
    roots: readonly string[],
  ): Promise<Assessment | undefined> => {
    const targets = directTargets(event, cwd);
    if (targets === undefined) return undefined;
    let unresolved = false;
    if (event.toolName === "copy" || event.toolName === "move") {
      try {
        const owners = await (options.resolveAnchors ?? anchorPaths)(event, ctx);
        targets.push(...owners.map((path) => ({ path, cwds: [cwd] })));
      } catch {
        unresolved = true;
      }
    }
    const protectedPaths = new Set<string>();
    for (const target of targets) {
      const candidates = target.cwds.flatMap((base) => {
        const path = expandHome(target.path);
        if (!isAbsolute(path) && base === undefined) return [undefined];
        // Absolute inputs avoid realpath on a `cd` destination that may not exist yet.
        const resolved = canonicalPath("/", isAbsolute(path) ? path : join(base ?? "/", path));
        return [
          resolved,
          ...(resolved
            ? (target.intoDirectory ?? []).map((name) => canonicalPath("/", join(resolved, name)))
            : []),
        ];
      });
      for (const candidate of candidates) {
        if (candidate === undefined) {
          unresolved = true;
          continue;
        }
        // Removing or replacing an ancestor also removes the protected files below it.
        if (roots.some((root) => within(root, candidate) || within(candidate, root)))
          protectedPaths.add(candidate);
      }
    }
    return { protectedPaths: [...protectedPaths], unresolved };
  };

  const describe = (event: ToolCallEvent, assessment: Assessment) => {
    const lines = assessment.protectedPaths.length
      ? [`Changes protected guard files: ${assessment.protectedPaths.join(", ")}.`]
      : [];
    if (assessment.unresolved)
      lines.push("Some mutation targets could not be resolved and may be protected guard files.");
    const input: unknown = event.input;
    const isBash =
      event.toolName === "bash" && isRecord(input) && typeof input.command === "string";
    return {
      concern: lines.join(" "),
      command: isBash ? String(input.command) : JSON.stringify(event.input, null, 2),
      title: isBash
        ? "Change command guard files?"
        : `Allow ${event.toolName} to change command guard files?`,
      contentLabel: isBash ? "Command" : "Tool input",
      approveLabel: isBash ? "Run command" : "Allow change",
    };
  };

  const review = async (
    event: ToolCallEvent,
    ctx: ExtensionContext,
    roots: readonly string[],
    initial: Assessment,
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
      const input: unknown = event.input;
      if (event.toolName === "bash" && isRecord(input) && typeof input.command === "string") {
        const reason = catastrophicCommandReason(input.command);
        if (reason) return block(reason);
      }
      return undefined;
    };
    try {
      if (!ctx.hasUI)
        return block(
          initial.protectedPaths.length
            ? "Changing command guard files requires interactive approval."
            : "Unresolved mutation targets may change command guard files; interactive approval is required.",
        );
      return await options.enqueue(async () => {
        const beforePrompt = state();
        if (beforePrompt) return beforePrompt;
        const approved = await confirmCommandPermission(ctx, {
          ...describe(event, initial),
          cwd,
          risks: [],
          signal: controller.signal,
        });
        const after = state();
        if (after) return after;
        // A symlink retargeted while the dialog was open changes what approval covers.
        const current = await assess(event, ctx, cwd, roots);
        if (JSON.stringify(current) !== JSON.stringify(initial))
          return block("Mutation targets changed during command guard file approval.");
        return approved ? undefined : block("Command guard file change was not approved.");
      });
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : "";
      return block(
        `Tool-call guard internal error while reviewing a protected-file change${detail}.`,
      );
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
      if (!FILE_MUTATIONS.has(event.toolName) && event.toolName !== "bash") return undefined;
      const cwd = ctx.cwd;
      const run = async (): Promise<BlockedCall | undefined> => {
        const roots = (options.paths ?? protectedGuardPaths(cwd)).map((root) =>
          canonicalPath(cwd, expandHome(root)),
        );
        let assessment: Assessment | undefined;
        try {
          assessment = await assess(
            event,
            ctx,
            cwd,
            roots.filter((root) => root !== undefined),
          );
        } catch (error) {
          const detail = error instanceof Error ? `: ${error.message}` : "";
          return block(`Tool-call guard internal error while resolving mutation targets${detail}.`);
        }
        if (!assessment) return undefined;
        if (roots.some((root) => root === undefined)) {
          // Without its own paths the gate cannot tell which mutations matter; it
          // reports that instead of implying the call lacks permission.
          const mutates = assessment.unresolved || (directTargets(event, cwd)?.length ?? 0) > 0;
          return mutates
            ? block("Tool-call guard internal error: could not resolve its protected paths.")
            : undefined;
        }
        if (!assessment.protectedPaths.length && !assessment.unresolved) return undefined;
        return review(
          event,
          ctx,
          roots.filter((root) => root !== undefined),
          assessment,
        );
      };
      // Synchronous fast path keeps ordinary tool calls free of an extra await.
      const targets = directTargets(event, cwd);
      if (targets === undefined) return undefined;
      if (targets.length === 0 && event.toolName !== "copy" && event.toolName !== "move")
        return undefined;
      return run();
    },
  };
}
