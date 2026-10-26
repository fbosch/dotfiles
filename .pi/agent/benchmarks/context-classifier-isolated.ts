import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  createToolSearchExtension,
  DefaultResourceLoader,
  type ExtensionFactory,
  getAgentDir,
  ModelRuntime,
  type SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { CLASSIFIER_DEFAULTS } from "../extensions/context-masking/classifier-compaction";
import { isClassifierCheckpoint } from "../extensions/context-masking/classifier-hook";
import contextMasking from "../extensions/context-masking/index";
import { DEFAULT_SETTINGS } from "../extensions/context-masking/policy";
import {
  appendStage,
  artifactsPreserved,
  autonomousStages,
  newHistory,
  scoreStagedRecall,
} from "./context-classifier-autonomous-history";

export function isolatedSettings() {
  return {
    packages: [],
    extensions: [],
    // A tools allowlist would also hide deferred recall; select startup declarations instead.
    defaultTools: ["tool_search"],
    compaction: { enabled: false, reserveTokens: 256, keepRecentTokens: 1 },
    retry: { enabled: false },
    contextMasking: { ...DEFAULT_SETTINGS, enabled: false, prefetchRecall: false },
    contextClassifierCompaction: {
      ...CLASSIFIER_DEFAULTS,
      enabled: true,
      includeContent: true,
      maxOutputBytes: 4_000,
    },
  };
}

export async function isolatedResources(
  cwd: string,
  agentDir: string,
  observer: ExtensionFactory = () => {},
) {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: SettingsManager.inMemory(isolatedSettings()),
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
    extensionFactories: [contextMasking, createToolSearchExtension(), observer],
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  if (loaded.errors.length) throw new Error("Isolated extension loading failed");
  return loader;
}

export async function isolatedSession(
  cwd: string,
  agentDir: string,
  modelRuntime: ModelRuntime,
  model: NonNullable<ReturnType<ModelRuntime["getModel"]>>,
  sessionManager: SessionManager,
  observer?: ExtensionFactory,
) {
  const resourceLoader = await isolatedResources(cwd, agentDir, observer);
  return createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model,
    thinkingLevel: "off",
    settingsManager: SettingsManager.inMemory(isolatedSettings()),
    sessionManager,
    resourceLoader,
  });
}

async function main() {
  // Create the authenticated runtime before redirecting this child process to an empty agent directory.
  // Credentials stay in the existing runtime; no auth files or private history are copied.
  const runtime = await ModelRuntime.create();
  const provider = process.argv[2] ?? "vercel-ai-gateway";
  const modelId = process.argv[3] ?? "openai/gpt-4.1-mini";
  const model = runtime.getModel(provider, modelId);
  if (!model) throw new Error("Isolated test model unavailable");
  const liveAgentDir = getAgentDir();
  const liveSettings = await readFile(join(liveAgentDir, "settings.json"));
  const liveDigest = createHash("sha256").update(liveSettings).digest("hex");
  const root = await mkdtemp(join(tmpdir(), "classifier-isolated-pi-"));
  const cwd = join(root, "work"),
    agentDir = join(root, "agent");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "settings.json"), JSON.stringify(isolatedSettings(), null, 2));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  console.error(JSON.stringify({ root }));
  const history = { ...newHistory(cwd), artifactRoot: join(agentDir, "cache", "context-masking") };
  const stages = autonomousStages("isolated-pi-1");
  const checkpoints = [];
  const toolCalls: Array<{ name: string; input: unknown }> = [];
  const extensionErrors: string[] = [];
  let lastRequest = -Infinity,
    waitedMs = 0,
    providerRequests = 0,
    blockedCalls = 0;
  const observer: ExtensionFactory = (pi) => {
    pi.on("before_provider_request", async () => {
      const pause = 15_000 - (performance.now() - lastRequest);
      if (pause > 0) {
        const start = performance.now();
        await new Promise((resolve) => setTimeout(resolve, pause));
        waitedMs += performance.now() - start;
      }
      lastRequest = performance.now();
      providerRequests++;
    });
    pi.on("tool_call", (event) => {
      toolCalls.push({ name: event.toolName, input: event.input });
      if (!["tool_search", "recall"].includes(event.toolName) || toolCalls.length > 12) {
        blockedCalls++;
        return {
          block: true,
          reason: "This isolated test permits only bounded tool discovery and saved-output recall.",
        };
      }
      return undefined;
    });
  };
  try {
    for (const [phase, stage] of stages.entries()) {
      await appendStage(history, stage, phase);
      const { session } = await isolatedSession(
        cwd,
        agentDir,
        runtime,
        model,
        history.manager,
        observer,
      );
      try {
        await session.bindExtensions({ onError: (error) => extensionErrors.push(error.error) });
        const before = performance.now(),
          waited = waitedMs;
        const compacted = await session.compact(stage.goal);
        const checkpoint = history.manager
          .getBranch()
          .filter((e) => e.type === "compaction")
          .at(-1);
        if (checkpoint?.type !== "compaction") throw new Error("No committed native checkpoint");
        checkpoints.push({
          phase: phase + 1,
          custom: isClassifierCheckpoint(checkpoint.details),
          bytes: Buffer.byteLength(compacted.summary),
          firstKeptEntryId: checkpoint.firstKeptEntryId,
          ms: performance.now() - before - (waitedMs - waited),
          usage: checkpoint.usage,
          details: checkpoint.details,
        });
        await writeFile(join(root, "checkpoints.json"), JSON.stringify(checkpoints, null, 2));
        if (phase !== 2) continue;
        const initialTools = session.getActiveToolNames();
        if (initialTools.includes("recall") || !initialTools.includes("tool_search"))
          throw new Error("Recall was not initially deferred");
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          session.abort().catch((error: unknown) => extensionErrors.push(String(error)));
        }, 180_000);
        const probeStart = performance.now(),
          probeWaited = waitedMs;
        try {
          await session.prompt(
            "Answer these questions as one JSON object with exactly these IDs. Use exact recorded strings, or null if unavailable.\n" +
              JSON.stringify(stage.probes.map(({ id, question }) => ({ id, question }))),
          );
        } finally {
          clearTimeout(timer);
        }
        const answer = session.getLastAssistantText() ?? "";
        const modelErrors = session.agent.state.messages.flatMap((message) =>
          message.role === "assistant" && message.stopReason === "error"
            ? [message.errorMessage ?? "Unknown provider error"]
            : [],
        );
        const score = scoreStagedRecall(stages, phase, answer);
        const unchanged =
          createHash("sha256")
            .update(await readFile(join(liveAgentDir, "settings.json")))
            .digest("hex") === liveDigest;
        const report = {
          root,
          model: model.id,
          provider: model.provider,
          checkpoints,
          initialTools,
          activeToolsAfter: session.getActiveToolNames(),
          toolCalls,
          score,
          answer,
          timedOut,
          blockedCalls,
          extensionErrors,
          modelErrors,
          providerRequests,
          probeMs: performance.now() - probeStart - (waitedMs - probeWaited),
          stats: session.getSessionStats(),
          artifactsPreserved: await artifactsPreserved(history),
          liveSettingsUnchanged: unchanged,
          note: "Real isolated Pi SDK session; full masking extension, native manual compaction hooks and built-in deferred tool discovery. Synthetic data only. Automatic prefetch and masking of newly generated probe outputs disabled. Existing live packages and project resources excluded. Not an interactive CLI/UI test.",
        };
        await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
        await writeFile(
          join(root, "session-entries.json"),
          JSON.stringify(history.manager.getBranch(), null, 2),
        );
        console.log(JSON.stringify(report, null, 2));
        if (
          !unchanged ||
          !report.artifactsPreserved ||
          extensionErrors.length ||
          modelErrors.length ||
          blockedCalls ||
          timedOut ||
          !toolCalls.some((c) => c.name === "tool_search") ||
          !toolCalls.some((c) => c.name === "recall") ||
          !checkpoints.every((c) => c.custom) ||
          score.positiveCorrect !== score.positiveTotal ||
          !score.unknownCorrect
        )
          throw new Error("Isolated end-to-end checks failed; see report");
      } finally {
        session.dispose();
      }
    }
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
}
if (import.meta.main)
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
