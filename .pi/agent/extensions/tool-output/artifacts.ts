import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
  ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import { isMatching, P } from "ts-pattern";
import { eligibleCapture, MAX_OUTPUT_BYTES, MAX_SESSION_BYTES, makePreview } from "./policy";
import { SEARCH_TOOL, type SearchInput, type SearchOutput, searchText } from "./search";

const REPORT = {
  type: "custom",
  customType: "tool-output-preview",
  data: {
    artifactPath: P.string,
    cwd: P.string,
    sha256: P.string.regex(/^[a-f0-9]{64}$/u),
    originalBytes: P.number.int().between(1, MAX_OUTPUT_BYTES),
  },
};

type ArtifactPi = Pick<ExtensionAPI, "appendEntry" | "getActiveTools" | "getAllTools">;

interface Dependencies {
  enabled: (ctx: ExtensionContext) => boolean;
  artifactRoot: () => string;
}

export interface OutputArtifacts {
  resetSession(): void;
  capture(
    event: ToolResultEvent,
    ctx: ExtensionContext,
  ): Promise<ToolResultEventResult | undefined>;
  search(ctx: ExtensionContext, input: SearchInput, signal?: AbortSignal): Promise<SearchOutput>;
}

function recordedArtifact(entries: readonly unknown[], cwd: string, path: string) {
  const report = [...entries]
    .reverse()
    .find(
      (entry) =>
        isMatching(REPORT, entry) && entry.data.cwd === cwd && entry.data.artifactPath === path,
    );
  return isMatching(REPORT, report) ? report.data : undefined;
}

async function searchRecordedArtifact(
  entries: readonly unknown[],
  cwd: string,
  input: SearchInput,
  signal?: AbortSignal,
): Promise<SearchOutput> {
  signal?.throwIfAborted();
  if (!isAbsolute(input.path) || resolve(input.path) !== input.path)
    throw new Error("Output artifact is not registered for this session and project.");
  const report = recordedArtifact(entries, cwd, input.path);
  if (!report) throw new Error("Output artifact is not registered for this session and project.");
  try {
    // A recorded capability is required before opening. Refuse links and special files without blocking.
    const handle = await open(
      input.path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.size !== report.originalBytes ||
        stat.size > MAX_OUTPUT_BYTES ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())
      )
        throw new Error("Invalid artifact");
      const bytes = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < bytes.length) {
        signal?.throwIfAborted();
        const chunk = await handle.read(bytes, length, bytes.length - length, length);
        if (chunk.bytesRead === 0) break;
        length += chunk.bytesRead;
      }
      const captured = bytes.subarray(0, length);
      if (
        length !== stat.size ||
        createHash("sha256").update(captured).digest("hex") !== report.sha256
      )
        throw new Error("Artifact changed");
      signal?.throwIfAborted();
      return searchText(captured.toString("utf8"), input);
    } finally {
      await handle.close();
    }
  } catch {
    throw new Error("Unable to search output artifact.");
  }
}

export function createOutputArtifacts(pi: ArtifactPi, dependencies: Dependencies): OutputArtifacts {
  let generation = 0;
  let storedBytes = 0;
  let warned = false;

  const resetSession = () => {
    generation++;
    storedBytes = 0;
    warned = false;
  };

  const capture = async (
    event: ToolResultEvent,
    ctx: ExtensionContext,
  ): Promise<ToolResultEventResult | undefined> => {
    if (event.parentToolCallId || ctx.signal?.aborted) return;
    if (event.toolName !== "bash" && !event.toolName.startsWith("mcp__")) return;
    const owner = generation;
    const cwd = ctx.cwd;
    const searchAvailable = pi.getActiveTools().includes(SEARCH_TOOL);
    try {
      if (!dependencies.enabled(ctx)) return;
      // Retrieval uses the existing paginated reader, not a new arbitrary-file API.
      if (!pi.getAllTools().some((tool) => tool.name === "read" && tool.exposure !== "hidden"))
        return;
      const capture = eligibleCapture(event);
      const structuredContent = event.structuredContent;
      if (capture === undefined || structuredContent === undefined) return;
      const { text } = capture;
      // Avoid disk writes for outputs whose required evidence already exceeds the preview budget.
      if (!makePreview(text, "/artifact/output.txt", searchAvailable, capture)) return;
      const bytes = Buffer.byteLength(text);
      if (storedBytes + bytes > MAX_SESSION_BYTES) return;
      storedBytes += bytes;
      const startedAt = performance.now();
      // No untrusted command, tool id, or output is used to construct filesystem paths.
      const directory = await mkdtemp(join(dependencies.artifactRoot(), "pi-tool-output-"));
      const artifactPath = join(directory, "output.txt");
      const preview = makePreview(text, artifactPath, searchAvailable, capture);
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
        toolName: event.toolName,
        source: capture.source,
        coverage: capture.coverage,
        isError: event.isError,
        ...(capture.exitCode === undefined ? {} : { exitCode: capture.exitCode }),
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
      if (
        ctx.signal?.aborted ||
        owner !== generation ||
        cwd !== ctx.cwd ||
        !dependencies.enabled(ctx)
      )
        return;
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
        if (ctx.hasUI) ctx.ui.notify("Unable to create tool output preview.", "warning");
      }
    }
  };

  const search = async (
    ctx: ExtensionContext,
    input: SearchInput,
    signal?: AbortSignal,
  ): Promise<SearchOutput> => {
    if (!dependencies.enabled(ctx))
      throw new Error("Output search is not enabled for this project.");
    const cwd = ctx.cwd;
    const sessionId = ctx.sessionManager.getSessionId();
    const proof = recordedArtifact(ctx.sessionManager.getBranch(), cwd, input.path);
    const result = await searchRecordedArtifact(ctx.sessionManager.getBranch(), cwd, input, signal);
    const current = recordedArtifact(ctx.sessionManager.getBranch(), cwd, input.path);
    if (
      ctx.cwd !== cwd ||
      !dependencies.enabled(ctx) ||
      ctx.sessionManager.getSessionId() !== sessionId ||
      !proof ||
      current?.sha256 !== proof.sha256
    )
      throw new Error("Output search session or project settings changed.");
    return result;
  };

  return { resetSession, capture, search };
}
