import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  addClassifierUsage,
  assertClassifierInput,
  requestClassifier,
  resolveClassifierEnabled,
} from "../../lib/classifier";
import {
  eligibleOutput,
  hasSensitiveText,
  MAX_ATTEMPTS,
  pilotConfig,
  selectBlocks,
  selectionRequest,
  splitOutput,
} from "./policy";

const ENTRY_TYPE = "tool-output-pilot";

function loadSettings(ctx: ExtensionContext): { global: unknown; project: unknown } {
  const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
    projectTrusted: ctx.isProjectTrusted(),
  });
  if (settings.drainErrors().length > 0) throw new Error("Invalid settings");
  return { global: settings.getGlobalSettings(), project: settings.getProjectSettings() };
}

interface Dependencies {
  request: typeof requestClassifier;
  settings: typeof loadSettings;
  artifactRoot: () => string;
}

export function registerToolOutputPilot(
  pi: Pick<ExtensionAPI, "on" | "appendEntry">,
  dependencies: Dependencies = {
    request: requestClassifier,
    settings: loadSettings,
    artifactRoot: tmpdir,
  },
): void {
  let attempts = 0;
  let generation = 0;
  let running = false;
  const controllers = new Set<AbortController>();
  const reset = () => {
    generation++;
    attempts = 0;
    running = false;
    for (const controller of controllers) controller.abort();
    controllers.clear();
  };
  pi.on("session_start", reset);
  pi.on("session_shutdown", reset);

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "bash" || event.parentToolCallId || ctx.signal?.aborted) return;
    const owner = generation;
    const record = (data: Record<string, unknown>) => {
      if (owner === generation) pi.appendEntry(ENTRY_TYPE, { version: 1, mode: "shadow", ...data });
    };
    let goal: string | undefined;
    try {
      const settings = dependencies.settings(ctx);
      if (resolveClassifierEnabled(settings.global, settings.project) !== true) return;
      const config = pilotConfig(settings.global);
      if (config.mode !== "shadow" || !ctx.isProjectTrusted()) return;
      goal = config.approvedCommands.find(
        (entry) => entry.cwd === ctx.cwd && entry.command === event.input.command,
      )?.goal;
    } catch {
      record({ outcome: "skipped", reason: "invalid-config" });
      return;
    }
    if (!goal || hasSensitiveText(goal) || hasSensitiveText(String(event.input.command))) return;
    if (running || attempts >= MAX_ATTEMPTS) return;
    const text = eligibleOutput(event);
    if (text === undefined) return;
    const blocks = splitOutput(text);
    if (!blocks) return;
    const input = selectionRequest(goal, blocks);
    try {
      assertClassifierInput(input);
    } catch {
      record({ outcome: "skipped", reason: "request-budget" });
      return;
    }

    attempts++;
    running = true;
    const controller = new AbortController();
    controllers.add(controller);
    const abort = () => controller.abort();
    ctx.signal?.addEventListener("abort", abort, { once: true });
    const startedAt = performance.now();
    let artifactPath: string | undefined;
    let reportPath: string | undefined;
    let usage: Awaited<ReturnType<typeof requestClassifier>>["usage"];
    try {
      // A private, random directory prevents call ids or untrusted output from choosing paths.
      const directory = await mkdtemp(join(dependencies.artifactRoot(), "pi-tool-output-pilot-"));
      artifactPath = join(directory, "output.txt");
      reportPath = join(directory, "report.json");
      await writeFile(artifactPath, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
      if (controller.signal.aborted || owner !== generation) return;
      const result = await dependencies.request(ctx.modelRegistry, input, {
        signal: controller.signal,
        settingsContext: ctx,
      });
      usage = result.usage;
      if (controller.signal.aborted || owner !== generation) return;
      const selections = result.ok ? selectBlocks(result.value.answers, input, blocks) : undefined;
      const proposedBytes = selections
        ? selections.reduce(
            (sum, selection) =>
              sum +
              (selection.selected
                ? Buffer.byteLength(text.slice(selection.start, selection.end))
                : 0),
            0,
          )
        : Buffer.byteLength(text);
      const report = {
        version: 1,
        mode: "shadow",
        outcome: result.ok ? "scored" : "fallback",
        reason: result.ok ? undefined : result.reason,
        toolCallId: event.toolCallId,
        coverage: "complete-model-facing-text",
        offsets: "utf16-code-units",
        originalBytes: Buffer.byteLength(text),
        proposedBytes,
        // Byte savings exclude a future preview envelope and do not imply token or latency savings.
        proposedOmittedBytes: Buffer.byteLength(text) - proposedBytes,
        elapsedMs: Math.round(performance.now() - startedAt),
        usage,
        blocks:
          selections ??
          blocks.map(({ id, start, end, pinned }) => ({
            id,
            start,
            end,
            pinned,
            selected: true,
          })),
      };
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      record({ ...report, artifactPath, reportPath });
    } catch {
      // Failure never replaces the original tool result; exception text may contain provider data.
      record({ outcome: "fallback", reason: "pilot-error", artifactPath, reportPath });
    } finally {
      ctx.signal?.removeEventListener("abort", abort);
      controllers.delete(controller);
      if (owner === generation) running = false;
    }
    // Only accounting changes. Returning content would discard structuredContent in Pi's hook chain.
    if (usage && owner === generation) {
      const combined = addClassifierUsage(event.usage, usage);
      if (combined) return { usage: combined };
    }
  });
}

export default function toolOutputPilot(pi: ExtensionAPI): void {
  registerToolOutputPilot(pi);
}
