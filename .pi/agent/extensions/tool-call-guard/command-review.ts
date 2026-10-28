import type { ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { INTERACTIVE_CLASSIFIER_TIMEOUT_MS, type requestClassifier } from "../../lib/classifier";
import { confirmCommandPermission } from "../prompt-ui/command-permission";
import { isRecord } from "../shared/is-record";
import { flaggedRisks, inspectCommand } from "./inspection";
import { commandFitsSandbox, type SandboxGrants } from "./sandbox";

interface CommandGuardSettings {
  readonly enabled: boolean;
  readonly mode: "shadow" | "confirm";
}

const DEFAULT_SETTINGS: CommandGuardSettings = { enabled: false, mode: "shadow" };

export function resolveCommandGuardSettings(settings: unknown): CommandGuardSettings {
  if (settings === undefined) return DEFAULT_SETTINGS;
  if (!isRecord(settings)) throw new Error("Invalid Pi settings");
  const classifier = settings.classifier;
  if (classifier === undefined) return DEFAULT_SETTINGS;
  if (!isRecord(classifier)) throw new Error("Invalid classifier settings");
  if (classifier.enabled === false) return DEFAULT_SETTINGS;
  if (classifier.enabled !== undefined && typeof classifier.enabled !== "boolean")
    throw new Error("Invalid classifier.enabled");
  const guard = classifier.commandGuard;
  if (guard === undefined) return DEFAULT_SETTINGS;
  if (!isRecord(guard) || typeof guard.enabled !== "boolean")
    throw new Error("Invalid classifier.commandGuard.enabled");
  const mode = guard.mode === undefined ? DEFAULT_SETTINGS.mode : guard.mode;
  if (mode !== "shadow" && mode !== "confirm")
    throw new Error("Invalid classifier.commandGuard.mode");
  return { enabled: guard.enabled, mode };
}

export type BlockedCall = { block: true; reason: string };
const block = (reason: string): BlockedCall => ({ block: true, reason });

export interface CommandReviewOptions {
  loadSettings: () => unknown;
  request: typeof requestClassifier;
  loadSandbox: () => SandboxGrants | undefined;
  enqueue: (task: () => Promise<BlockedCall | undefined>) => Promise<BlockedCall | undefined>;
}

export function createCommandReview(options: CommandReviewOptions) {
  let shadowPending: AbortController | undefined;
  const pending = new Set<AbortController>();
  let generation = 0;
  let errorNotified = false;
  let oversizedNotified = false;

  const cancel = () => {
    generation += 1;
    for (const controller of pending) controller.abort();
    pending.clear();
    shadowPending = undefined;
  };
  const reset = () => {
    cancel();
    errorNotified = false;
    oversizedNotified = false;
  };
  const warn = (ctx: ExtensionContext, message: string) => {
    if (ctx.hasUI) ctx.ui.notify(message, "warning");
    else console.warn(message);
  };
  const warnError = (ctx: ExtensionContext) => {
    if (errorNotified) return;
    errorNotified = true;
    warn(ctx, "Semantic command guard could not assess a command.");
  };
  const settings = (ctx: ExtensionContext) => {
    try {
      return resolveCommandGuardSettings(options.loadSettings());
    } catch {
      warnError(ctx);
      return undefined;
    }
  };

  // The caller has already rejected catastrophic commands, which are never approvable.
  const check = (
    event: ToolCallEvent & { input: { command: string } },
    ctx: ExtensionContext,
  ): Promise<BlockedCall | undefined> | BlockedCall | undefined => {
    const config = settings(ctx);
    if (!config?.enabled) {
      cancel();
      return;
    }
    const confirming = config.mode === "confirm";
    const signal = ctx.signal;
    if (signal?.aborted)
      return confirming ? block("Semantic command guard review was cancelled.") : undefined;

    const command = event.input.command;
    const cwd = ctx.cwd;
    const inspection = inspectCommand(command);
    if (inspection.kind === "oversized") {
      if (confirming) return block("Semantic command guard cannot assess an oversized command.");
      if (!oversizedNotified) {
        oversizedNotified = true;
        warn(
          ctx,
          "Semantic command guard skipped an oversized command. Shadow mode does not block execution.",
        );
      }
      return;
    }
    if (inspection.kind === "skip" || commandFitsSandbox(command, cwd, options.loadSandbox()))
      return;
    // shortcut: shadow mode samples one in-flight command to bound background cost.
    // Confirm mode must assess every selected call; it never uses this skip.
    if (!confirming && shadowPending) return;
    const controller = new AbortController();
    pending.add(controller);
    if (!confirming) shadowPending = controller;
    const currentGeneration = generation;
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    const approvalState = (): BlockedCall | undefined => {
      if (controller.signal.aborted || generation !== currentGeneration)
        return block("Semantic command guard review was cancelled.");
      const current = settings(ctx);
      if (!current?.enabled || current.mode !== config.mode)
        return block("Semantic command guard settings changed during review.");
      if (ctx.cwd !== cwd)
        return block("Working directory changed during semantic command guard review.");
      if (event.input.command !== command)
        return block("Bash command changed during semantic command guard review.");
      return undefined;
    };

    const review = async (): Promise<BlockedCall | undefined> => {
      try {
        const before = approvalState();
        if (before) return confirming ? before : undefined;
        const result = await options.request(ctx.modelRegistry, inspection.input, {
          signal: controller.signal,
          settingsContext: ctx,
          // The short background budget is split across providers and can cut off the primary.
          ...(confirming ? { timeoutMs: INTERACTIVE_CLASSIFIER_TIMEOUT_MS } : {}),
        });
        const after = approvalState();
        if (after) return confirming ? after : undefined;
        if (!result.ok) {
          // A classifier policy opt-out is intentional, not an unavailable verdict.
          if (result.reason === "disabled") return undefined;
          if (result.reason !== "caller-cancellation") warnError(ctx);
          return confirming
            ? block("Semantic command guard could not assess this command.")
            : undefined;
        }
        const risks = flaggedRisks(result.value.answers);
        if (risks.length === 0) return;
        if (!confirming) {
          warn(
            ctx,
            `Semantic command guard flagged ${risks.join(" and ")}. Shadow mode does not block execution.`,
          );
          return;
        }
        if (!ctx.hasUI)
          return block(
            "Semantic command guard flagged this command; interactive approval is required.",
          );

        // Serialize dialogs from parallel/nested bash calls without sharing approvals.
        return await options.enqueue(async () => {
          const beforePrompt = approvalState();
          if (beforePrompt) return beforePrompt;
          const approved = await confirmCommandPermission(ctx, {
            command,
            cwd,
            risks,
            signal: controller.signal,
          });
          // Approval applies only to this exact command in this session and mode.
          const afterPrompt = approvalState();
          if (afterPrompt) return afterPrompt;
          return approved ? undefined : block("Bash command was not approved.");
        });
      } catch {
        if (!controller.signal.aborted && generation === currentGeneration) warnError(ctx);
        return confirming
          ? block("Semantic command guard could not approve this command.")
          : undefined;
      } finally {
        signal?.removeEventListener("abort", onAbort);
        pending.delete(controller);
        if (shadowPending === controller) shadowPending = undefined;
      }
    };

    if (confirming) return review();
    // Shadow mode returns void; only confirm mode awaits the classifier and user.
    void Promise.resolve().then(review);
    return undefined;
  };

  return { cancel, reset, check };
}
