import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { eligibleOutput, MAX_SESSION_BYTES, makePreview, outputEnabled } from "./policy";
import { createOutputSearchTool, SEARCH_TOOL } from "./search";

function loadSettings(ctx: ExtensionContext): { global: unknown; project: unknown } {
  const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
    projectTrusted: ctx.isProjectTrusted(),
  });
  if (settings.drainErrors().length > 0) throw new Error("Invalid settings");
  return { global: settings.getGlobalSettings(), project: settings.getProjectSettings() };
}

interface Dependencies {
  settings: typeof loadSettings;
  artifactRoot: () => string;
}

export function registerToolOutput(
  pi: Pick<ExtensionAPI, "on" | "appendEntry" | "getAllTools" | "getActiveTools" | "registerTool">,
  dependencies: Dependencies = { settings: loadSettings, artifactRoot: tmpdir },
): void {
  let generation = 0;
  let storedBytes = 0;
  let warned = false;
  const reset = () => {
    generation++;
    storedBytes = 0;
    warned = false;
  };
  pi.on("session_start", reset);
  pi.on("session_shutdown", reset);

  const enabled = (ctx: ExtensionContext) => {
    const settings = dependencies.settings(ctx);
    return outputEnabled(settings.global, settings.project, ctx.isProjectTrusted());
  };
  pi.registerTool(createOutputSearchTool(enabled));
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "bash" || event.parentToolCallId || ctx.signal?.aborted) return;
    const owner = generation;
    const cwd = ctx.cwd;
    const searchAvailable = pi.getActiveTools().includes(SEARCH_TOOL);
    try {
      if (!enabled(ctx)) return;
      // Retrieval uses the existing paginated reader, not a new arbitrary-file API.
      if (!pi.getAllTools().some((tool) => tool.name === "read" && tool.exposure !== "hidden"))
        return;
      const text = eligibleOutput(event);
      const structuredContent = event.structuredContent;
      if (text === undefined || structuredContent === undefined) return;
      // Avoid disk writes for outputs whose required evidence already exceeds the preview budget.
      if (!makePreview(text, "/artifact/output.txt", searchAvailable)) return;
      const bytes = Buffer.byteLength(text);
      if (storedBytes + bytes > MAX_SESSION_BYTES) return;
      storedBytes += bytes;
      const startedAt = performance.now();
      // No untrusted command, tool id, or output is used to construct filesystem paths.
      const directory = await mkdtemp(join(dependencies.artifactRoot(), "pi-tool-output-"));
      const artifactPath = join(directory, "output.txt");
      const preview = makePreview(text, artifactPath, searchAvailable);
      if (!preview) return;
      await writeFile(artifactPath, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
      const report = {
        version: 2,
        mode: "preview",
        strategy: "repeated-progress",
        cwd,
        sha256: createHash("sha256").update(text).digest("hex"),
        toolCallId: event.toolCallId,
        artifactPath,
        coverage: "complete-model-facing-text",
        originalBytes: bytes,
        previewBytes: Buffer.byteLength(preview.text),
        totalLines: preview.totalLines,
        selectedLines: preview.selectedLines,
        ranges: preview.ranges,
        elapsedMs: Math.round(performance.now() - startedAt),
      };
      await writeFile(join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      // Never publish a result into a replacement session or after a project/settings change.
      if (ctx.signal?.aborted || owner !== generation || cwd !== ctx.cwd || !enabled(ctx)) return;
      pi.appendEntry("tool-output-preview", report);
      return {
        content: [{ type: "text", text: preview.text }],
        // Pi drops structured data when content changes unless explicitly returned with it.
        // Keep the complete native object for programmatic consumers; only chat text is reduced.
        structuredContent,
      };
    } catch {
      if (owner === generation && !warned) {
        warned = true;
        pi.appendEntry("tool-output-preview", {
          version: 2,
          outcome: "unchanged",
          reason: "preview-error",
        });
        if (ctx.hasUI) ctx.ui.notify("Unable to create Bash output preview.", "warning");
      }
    }
  });
}

export default function toolOutput(pi: ExtensionAPI): void {
  registerToolOutput(pi);
}
