import { join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  isToolCallEventType,
} from "@earendil-works/pi-coding-agent";
import { requestClassifier } from "../../lib/classifier";
import { readJsonConfig } from "../../lib/extension-config";
import { catastrophicCommandReason } from "../catastrophic-command-guard";
import { isRecord } from "../shared/is-record";
import { flaggedRisks, inspectCommand } from "./inspection";

export function commandGuardEnabled(settings: unknown): boolean {
  if (settings === undefined) return false;
  if (!isRecord(settings)) throw new Error("Invalid Pi settings");
  const classifier = settings.classifier;
  if (classifier === undefined) return false;
  if (!isRecord(classifier)) throw new Error("Invalid classifier settings");
  if (classifier.enabled === false) return false;
  if (classifier.enabled !== undefined && typeof classifier.enabled !== "boolean")
    throw new Error("Invalid classifier.enabled");
  const guard = classifier.commandGuard;
  if (guard === undefined) return false;
  if (!isRecord(guard) || typeof guard.enabled !== "boolean")
    throw new Error("Invalid classifier.commandGuard.enabled");
  return guard.enabled;
}

interface Dependencies {
  loadSettings: () => unknown;
  request: typeof requestClassifier;
}

export default function semanticCommandGuard(
  pi: ExtensionAPI,
  dependencies: Dependencies = {
    loadSettings: () => readJsonConfig(join(getAgentDir(), "settings.json")),
    request: requestClassifier,
  },
): void {
  let pending: AbortController | undefined;
  let generation = 0;
  let errorNotified = false;
  let oversizedNotified = false;

  const cancel = () => {
    generation += 1;
    pending?.abort();
    pending = undefined;
  };
  const reset = () => {
    cancel();
    errorNotified = false;
    oversizedNotified = false;
  };
  pi.on("session_start", reset);
  pi.on("session_before_switch", reset);
  pi.on("session_shutdown", cancel);

  const warn = (ctx: ExtensionContext, message: string) => {
    if (ctx.hasUI) ctx.ui.notify(message, "warning");
    else console.warn(message);
  };
  const warnError = (ctx: ExtensionContext) => {
    if (errorNotified) return;
    errorNotified = true;
    warn(ctx, "Semantic command guard could not assess a command.");
  };
  const enabled = (ctx: ExtensionContext) => {
    try {
      return commandGuardEnabled(dependencies.loadSettings());
    } catch {
      warnError(ctx);
      return false;
    }
  };

  pi.on("tool_call", (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    if (!enabled(ctx)) {
      cancel();
      return;
    }
    if (ctx.signal?.aborted) return;
    const inspection = inspectCommand(event.input.command);
    if (inspection.kind === "skip") return;
    if (inspection.kind === "oversized") {
      if (!oversizedNotified) {
        oversizedNotified = true;
        warn(
          ctx,
          "Semantic command guard skipped an oversized command. Shadow mode does not block execution.",
        );
      }
      return;
    }
    if (catastrophicCommandReason(event.input.command)) return;
    // shortcut: sample at most one in-flight command to bound background cost.
    // A blocking guard would need a verdict for every selected call instead.
    if (pending) return;
    const controller = new AbortController();
    pending = controller;
    const currentGeneration = generation;
    const onAbort = () => controller.abort();
    ctx.signal?.addEventListener("abort", onAbort, { once: true });

    // Returning void keeps network latency out of the tool execution path.
    void Promise.resolve()
      .then(async () => {
        if (controller.signal.aborted || !enabled(ctx)) return;
        const result = await dependencies.request(ctx.modelRegistry, inspection.input, {
          signal: controller.signal,
          settingsContext: ctx,
        });
        if (controller.signal.aborted || generation !== currentGeneration || !enabled(ctx)) return;
        if (!result.ok) {
          if (result.reason !== "disabled" && result.reason !== "caller-cancellation")
            warnError(ctx);
          return;
        }
        const risks = flaggedRisks(result.value.answers);
        if (risks.length > 0)
          warn(
            ctx,
            `Semantic command guard flagged ${risks.join(" and ")}. Shadow mode does not block execution.`,
          );
      })
      .catch(() => {
        if (!controller.signal.aborted && generation === currentGeneration) warnError(ctx);
      })
      .finally(() => {
        ctx.signal?.removeEventListener("abort", onAbort);
        if (pending === controller) pending = undefined;
      });
  });
}
