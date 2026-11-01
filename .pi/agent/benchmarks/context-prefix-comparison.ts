import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getCurrentSystemPrompt, getCurrentTools, type AssistantMessage, type Usage } from "@earendil-works/pi-ai";
import {
  createAgentSession, createToolSearchExtension, DefaultResourceLoader, getAgentDir, ModelRuntime,
  SessionManager, SettingsManager, type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import contextMasking from "../extensions/context-masking/index";
import openaiCapabilities, { applyFastServiceTierForPayload } from "../extensions/openai-capabilities";
import { saveConversationArtifact } from "../extensions/context-masking/evidence-archive";
import { isClassifierCheckpoint } from "../extensions/context-masking/classifier-hook";
import { createCodexPrefixCompaction, MAX_SUMMARY_BYTES, PREFIX_COMPACTION, SUMMARY_INSTRUCTION } from "./codex-prefix-compaction";

export type Arm = "extractive" | "prefix" | "native";
type Phase = "prefill" | "compaction" | "probe";
export interface Fact { id: string; question: string; expected: string | null; stale?: string }
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const OPERATION_MS = 180_000;
const LIMITS = { modelRequests: 8, classifierRequests: 32 };
const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function routeFastPayload(payload: unknown, replacement?: unknown): unknown {
  return applyFastServiceTierForPayload(replacement ?? payload) ?? replacement;
}
export function retainedTail(projection: ReturnType<SessionManager["buildSessionProjection"]>, firstKeptEntryId: string) {
  const cut = projection.entries.findIndex(entry => entry.sourceEntry.id === firstKeptEntryId);
  if (cut < 0) throw Error("Missing native cut point");
  // Pi moves the effective system message into the checkpoint. Its old source ID is not retained.
  return projection.entries.slice(cut).filter(entry => entry.messages.some(message => message.role !== "system"));
}
export function comparisonHash(value: unknown, isolatedPaths: readonly string[] = []): string {
  // Provider signatures vary across requests. Within-arm retention uses an unmodified hash instead.
  let serialized = JSON.stringify(value, (key, item: unknown) => {
    if (["timestamp", "usage", "responseId", "durationMs", "textSignature"].includes(key)) return undefined;
    if (key === "content" && Array.isArray(item))
      return item.filter(block => !(typeof block === "object" && block !== null && "type" in block && block.type === "thinking"));
    return item;
  });
  if (typeof serialized !== "string") throw Error("Unserializable request or tail");
  for (const path of isolatedPaths) serialized = serialized.replaceAll(path, "<isolated>");
  return hash(serialized);
}
export function fixture(seed: string) {
  const suffix = hash(seed).slice(0, 10);
  const facts: Fact[] = [
    { id: "schema", question: "Which schema revision is currently approved?", expected: "schema-v7-" + suffix, stale: "schema-v2-" + suffix },
    { id: "retention", question: "What is the current approved retention period?", expected: "37 days", stale: "14 days" },
    { id: "digest", question: "What exact digest did the one-time diagnostic return?", expected: "diag-" + suffix },
    { id: "path", question: "What is the approved output path?", expected: "artifacts/æble-" + suffix + ".json" },
    { id: "approval", question: "What action requires fresh user approval?", expected: "production deployment" },
    { id: "unknown", question: "What is the database password?", expected: null },
  ];
  const evidence = [
    "Initial approval: schema-v2-" + suffix + "; retention 14 days.",
    "Revision approved by the user. Supersedes the initial approval: schema-v7-" + suffix + "; retention 37 days.",
    "One-time diagnostic output: diag-" + suffix + ". This result cannot be recreated.",
    "Approved output path: artifacts/æble-" + suffix + ".json",
    "User restriction: production deployment requires fresh user approval. No approval has been granted.",
  ];
  const noise = Array.from({ length: 12 }, (_, i) =>
    "Trace block " + i + ": " + ("synthetic scan passed; no changes to task decisions. ").repeat(40));
  return { seed, facts, evidence, noise, sourceHash: hash(JSON.stringify({ evidence, noise })) };
}

export function orderedArms(seedIndex: number, includeNative = false): Arm[] {
  const arms: Arm[] = includeNative ? ["extractive", "prefix", "native"] : ["extractive", "prefix"];
  const offset = seedIndex % arms.length;
  return [...arms.slice(offset), ...arms.slice(0, offset)];
}

export function armSettings(arm: Arm, modelId: string, thinking: ThinkingLevel) {
  return {
    packages: [], extensions: [], defaultTools: ["tool_search"],
    compaction: { enabled: false, reserveTokens: 16384, keepRecentTokens: 1024 },
    retry: { enabled: false },
    // The small pilot does not exercise rolling pressure or automatic prefetch. Both arms
    // start with the same archives and explicit recall, so lookup remains measurable.
    contextMasking: { enabled: true, rollingEnabled: true, prefetchRecall: false, retentionDays: 0 },
    contextClassifierCompaction: {
      enabled: arm === "extractive", mode: "extractive", provider: "openrouter",
      model: "typesafe/jev-1.14", includeContent: true, maxOutputBytes: MAX_SUMMARY_BYTES,
      maxRequestBytes: 28000, maxConcurrentAssessments: 2,
    },
    compactionModel: { enabled: false, model: "openai-codex/" + modelId, thinkingLevel: thinking },
  };
}

export function score(facts: readonly Fact[], text: string) {
  let value: unknown;
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/gu, "")); }
  catch { return { valid: false, correct: 0, total: facts.length, stale: 0 }; }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { valid: false, correct: 0, total: facts.length, stale: 0 };
  const answers: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const valid = Object.keys(answers).length === facts.length &&
    facts.every(fact => Object.hasOwn(answers, fact.id) && (answers[fact.id] === null || typeof answers[fact.id] === "string"));
  return {
    valid, correct: valid ? facts.filter(fact => answers[fact.id] === fact.expected).length : 0,
    total: facts.length, stale: facts.filter(fact => fact.stale !== undefined && answers[fact.id] === fact.stale).length,
  };
}

interface Call {
  kind: Phase | "classifier" | "recall";
  ms: number;
  usage?: Usage;
  stopReason?: string;
  failed?: boolean;
}

export function summarizeUsage(calls: readonly Call[]) {
  const known = calls.filter((call): call is Call & { usage: Usage } => call.usage !== undefined);
  const total = known.reduce((sum, call) => ({
    input: sum.input + call.usage.input, output: sum.output + call.usage.output,
    cacheRead: sum.cacheRead + call.usage.cacheRead, cacheWrite: sum.cacheWrite + call.usage.cacheWrite,
  }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  const prompt = total.input + total.cacheRead + total.cacheWrite;
  return { ...total, requests: calls.length, usageMissing: calls.length - known.length,
    prompt, uncached: total.input + total.cacheWrite, cacheReadShare: prompt ? total.cacheRead / prompt : null };
}

function syntheticAssistant(text: string): AssistantMessage {
  return {
    role: "assistant", content: [{ type: "text", text }], api: "openai-codex-responses",
    provider: "openai-codex", model: "synthetic-fixture", stopReason: "stop", timestamp: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

export interface ComparisonOptions {
  model: string;
  thinking: ThinkingLevel;
  seeds: number;
  includeNative: boolean;
}

export function preflight(options: ComparisonOptions) {
  if (!options.model || !THINKING_LEVELS.includes(options.thinking) ||
      !Number.isInteger(options.seeds) || options.seeds < 1 || options.seeds > 4)
    throw Error("Invalid comparison options");
  return {
    status: "preflight-only", networkCalls: 0, options,
    cases: Array.from({ length: options.seeds }, (_, index) => {
      const data = fixture("prefix-holdout-" + (index + 1));
      return { seed: data.seed, sourceHash: data.sourceHash, facts: data.facts.length,
        order: orderedArms(index, options.includeNative),
        estimatedFixtureTokens: Math.ceil(Buffer.byteLength(JSON.stringify(data.evidence) + JSON.stringify(data.noise)) / 4) };
    }),
    controls: {
      retainedTailTokens: 1024, inlineTextBudgetBytes: MAX_SUMMARY_BYTES, operationMs: OPERATION_MS, limits: LIMITS,
      automaticThresholdsMeasured: false, prefetch: false, background: false, warmup: false,
      cachePolicy: "Fresh sessions with one real prefill each; provider cache uncontrolled.",
      interpretation: "Native versus prefix is the same-model summary comparison; extractive is a Jev workflow reference.",
      promotionGate: "All facts exact, no stale answers; at least 10% less uncached compaction-plus-probe input and no >10% median latency regression versus native. Pilot only, not statistical evidence.",
      billing: "SDK token usage only. Codex subscription billing and actual dollar savings are unknown.",
    },
  };
}

export async function runComparison(options: ComparisonOptions) {
  const plan = preflight(options);
  const liveAgentDir = getAgentDir();
  const liveSettingsPath = join(liveAgentDir, "settings.json");
  const settingsHash = hash(await readFile(liveSettingsPath, "utf8"));
  const runtime = await ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false });
  const model = runtime.getModel("openai-codex", options.model);
  if (!model || model.api !== "openai-codex-responses") throw Error("Configured Codex model is unavailable");
  const cache = join(liveAgentDir, "cache", "context-prefix-comparison");
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(cache, "cohort-"));
  const rows: Array<Record<string, unknown>> = [];
  const paired = new Map<string, { payload: string; tail?: string }>();
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  let failure: string | undefined;
  try {
    for (const data of plan.cases) for (const arm of data.order) {
      const source = fixture(data.seed);
      const agentDir = join(root, data.seed, arm, "agent"), cwd = join(root, data.seed, arm, "workspace");
      await mkdir(agentDir, { recursive: true, mode: 0o700 });
      await mkdir(cwd, { recursive: true, mode: 0o700 });
      const settings = armSettings(arm, options.model, options.thinking);
      await writeFile(join(agentDir, "settings.json"), JSON.stringify(settings), { mode: 0o600 });
      process.env.PI_CODING_AGENT_DIR = agentDir;
      const manager = SessionManager.inMemory(cwd);
      const archiveRoot = join(agentDir, "cache", "context-masking");
      const items = [];
      for (const text of source.evidence) {
        manager.appendMessage({ role: "user", content: text, timestamp: 0 });
        manager.appendMessage(syntheticAssistant("Recorded."));
        const saved = await saveConversationArtifact(archiveRoot, manager.getSessionId(), text);
        items.push({ ...saved, text });
      }
      manager.appendCustomEntry("context-masking", { items });
      for (const noise of source.noise) {
        manager.appendMessage({ role: "user", content: "Record this synthetic scan trace.", timestamp: 0 });
        manager.appendMessage(syntheticAssistant(noise));
      }
      let phase: Phase = "prefill", modelRequests = 0, classifierRequests = 0, toolCalls = 0;
      let contractFailure: string | undefined;
      const calls: Call[] = [], pending: Promise<unknown>[] = [];
      let tailHash: string | undefined;
      let tailIntegrityHash: string | undefined;
      let systemHash: string | undefined;
      let tailIds: string[] = [];
      const canonical = (value: unknown) => comparisonHash(value, [agentDir, cwd, manager.getSessionId()]);
      const originalStream = runtime.streamSimple.bind(runtime);
      const originalComplete = runtime.complete.bind(runtime);
      const originalClassify = runtime.classify.bind(runtime);
      const checkModel = () => { if (++modelRequests > LIMITS.modelRequests) throw Error("Model request limit"); };
      runtime.streamSimple = (selected, context, opts) => {
        checkModel();
        const call: Call = { kind: phase, ms: 0 }, start = performance.now();
        calls.push(call);
        const stream = originalStream(selected, context, {
          ...opts, maxRetries: 0, transport: "sse",
          onPayload: async (payload, selectedModel) => routeFastPayload(payload, await opts?.onPayload?.(payload, selectedModel)),
        });
        pending.push(stream.result().then(result => {
          call.ms = performance.now() - start; call.stopReason = result.stopReason;
          call.failed = result.stopReason === "error" || result.stopReason === "aborted";
          if (!call.failed || result.usage.totalTokens > 0) call.usage = result.usage;
        }).catch(() => { call.failed = true; contractFailure = "Stream result failed"; }));
        return stream;
      };
      runtime.complete = async (selected, context, opts) => {
        checkModel();
        const call: Call = { kind: phase, ms: 0 }, start = performance.now();
        calls.push(call);
        try {
          const result = await originalComplete(selected, context, opts);
          call.stopReason = result.stopReason;
          call.failed = result.stopReason === "error" || result.stopReason === "aborted";
          if (!call.failed || result.usage.totalTokens > 0) call.usage = result.usage;
          return result;
        } catch (error) { call.failed = true; throw error; }
        finally { call.ms = performance.now() - start; }
      };
      runtime.classify = async (selected, context, opts) => {
        if (++classifierRequests > LIMITS.classifierRequests) throw Error("Classifier request limit");
        const call: Call = { kind: phase === "probe" ? "recall" : "classifier", ms: 0 }, start = performance.now();
        calls.push(call);
        try {
          const result = await originalClassify(selected, context, opts);
          call.stopReason = result.stopReason; call.failed = result.stopReason !== "stop";
          if (result.usage && (!call.failed || result.usage.totalTokens > 0)) call.usage = result.usage;
          return result;
        } catch (error) { call.failed = true; throw error; }
        finally { call.ms = performance.now() - start; }
      };
      const observer: ExtensionFactory = pi => {
        pi.on("before_provider_request", event => {
          if (phase !== "prefill") return;
          const fingerprint = canonical(event.payload);
          const prior = paired.get(data.seed);
          if (prior && prior.payload !== fingerprint) contractFailure = "Paired prefill payloads differ";
          else if (!prior) paired.set(data.seed, { payload: fingerprint });
          row.prefillPayloadHash = fingerprint;
          row.prefillPayloadBytes = Buffer.byteLength(JSON.stringify(event.payload));
        });
        pi.on("session_before_compact", (event, ctx) => {
          const prefix = JSON.stringify([...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages]);
          const projection = ctx.sessionManager.buildSessionProjection();
          const tail = retainedTail(projection, event.preparation.firstKeptEntryId);
          systemHash = canonical([getCurrentSystemPrompt(projection.messages), getCurrentTools(projection.messages)]);
          row.systemStateHash = systemHash;
          tailIds = tail.map(entry => entry.sourceEntry.id);
          tailHash = canonical(tail.flatMap(entry => entry.messages));
          tailIntegrityHash = hash(JSON.stringify(tail.flatMap(entry => entry.messages)));
          const prior = paired.get(data.seed);
          if (!prior || (prior.tail !== undefined && prior.tail !== tailHash)) {
            contractFailure = "Paired retained tails differ";
            return { cancel: true };
          }
          prior.tail = tailHash;
          row.retainedTailHash = tailHash;
          row.retainedTailEntries = tail.length;
          if (source.facts.some(fact => fact.expected !== null && !prefix.includes(fact.expected))) {
            contractFailure = "Scored evidence was not in the compacted prefix";
            return { cancel: true };
          }
          return undefined;
        });
        pi.on("tool_call", event => {
          if (phase !== "probe" || ++toolCalls > 8 || !["tool_search", "recall"].includes(event.toolName)) {
            contractFailure = "Out-of-scope or excessive tool call";
            return { block: true, reason: "Only bounded saved-evidence recall is allowed during the probe." };
          }
          return undefined;
        });
      };
      const memory = SettingsManager.inMemory(settings);
      const loader = new DefaultResourceLoader({
        cwd, agentDir, settingsManager: memory, noExtensions: true, noContextFiles: true,
        noSkills: true, noThemes: true, noPromptTemplates: true,
        extensionFactories: [openaiCapabilities, observer, createToolSearchExtension(), contextMasking,
          ...(arm === "prefix" ? [createCodexPrefixCompaction({ timeoutMs: OPERATION_MS })] : [])],
        systemPromptOverride: () => "This synthetic experiment tracks approved decisions. Prefer the latest explicit user revision. Historical evidence can be recovered with recall. Never guess missing facts.",
      });
      let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
      const row: Record<string, unknown> = { seed: data.seed, arm, sourceHash: data.sourceHash, calls };
      rows.push(row);
      try {
        await loader.reload();
        if (loader.getExtensions().errors.length) throw Error("Experiment extension loading failed");
        const created = await createAgentSession({ cwd, agentDir, modelRuntime: runtime, model,
          thinkingLevel: options.thinking, settingsManager: memory, sessionManager: manager,
          resourceLoader: loader, tools: [] });
        session = created.session;
        const active = session;
        await active.bindExtensions({ onError: () => { contractFailure = "Extension error"; active.agent.abort(); active.abortCompaction(); } });
        const operation = async (work: () => Promise<unknown>) => {
          const timer = setTimeout(() => { contractFailure = "Operation deadline"; active.agent.abort(); active.abortCompaction(); }, OPERATION_MS);
          try { return await work(); } finally { clearTimeout(timer); }
        };
        let start = performance.now();
        await operation(() => active.prompt("Acknowledge that you have recorded the decisions and traces. Reply only READY. Do not use tools."));
        row.prefillMs = performance.now() - start;
        await Promise.all(pending);
        if (active.getLastAssistantText()?.trim() !== "READY") throw Error("Non-equivalent prefill acknowledgement");
        if (contractFailure || calls.some(call => call.failed)) throw Error("Prefill failed");
        phase = "compaction"; start = performance.now();
        await operation(() => active.compact(arm === "prefix" ? undefined : SUMMARY_INSTRUCTION));
        row.compactionMs = performance.now() - start;
        const committed = manager.getBranch().filter(entry => entry.type === "compaction").at(-1);
        const after = manager.buildSessionProjection();
        row.systemStateIntact = canonical([getCurrentSystemPrompt(after.messages), getCurrentTools(after.messages)]) === systemHash;
        if (!row.systemStateIntact) throw Error("System prompt or tools changed during compaction");
        const retained = manager.buildSessionProjection().entries.filter(entry => tailIds.includes(entry.sourceEntry.id));
        if (retained.length !== tailIds.length || hash(JSON.stringify(retained.flatMap(entry => entry.messages))) !== tailIntegrityHash)
          throw Error("Retained tail changed during compaction");
        row.retainedTailIntact = true;
        if (committed?.type !== "compaction" || contractFailure) throw Error("Compaction failed");
        const details: unknown = committed.details;
        const prefixAccepted = typeof details === "object" && details !== null && "type" in details && details.type === PREFIX_COMPACTION;
        if ((arm === "extractive" && !isClassifierCheckpoint(details)) || (arm === "prefix" && !prefixAccepted))
          throw Error("Requested compactor did not supply the checkpoint");
        row.checkpointBytes = Buffer.byteLength(committed.summary);
        if (arm === "native" && Buffer.byteLength(committed.summary) > MAX_SUMMARY_BYTES)
          throw Error("Native summary exceeded the common text budget");
        row.route = arm;
        row.compactionUsage = summarizeUsage(calls.filter(call => call.kind === "compaction" || call.kind === "classifier"));
        phase = "probe"; start = performance.now();
        await operation(() => active.prompt("Answer as one JSON object with exactly these IDs. Use exact recorded strings, or null when unavailable. Use recall if needed. Prefer latest approvals.\n" +
          JSON.stringify(source.facts.map(({ id, question }) => ({ id, question })))));
        row.probeMs = performance.now() - start;
        await Promise.all(pending);
        row.score = score(source.facts, active.getLastAssistantText() ?? "");
        row.toolCalls = toolCalls;
        row.usage = summarizeUsage(calls);
        if (contractFailure || calls.some(call => call.failed)) throw Error("Probe or request contract failed");
        // Verify the shared archived evidence, independent of which compactor ran.
        for (const item of items)
          if (hash(await readFile(item.path, "utf8")) !== item.entryId) throw Error("Shared evidence archive changed");
        row.sharedArchivesIntact = true;
        row.status = "complete";
      } catch (error) {
        const known = new Set([
          "Model request limit", "Classifier request limit", "Experiment extension loading failed",
          "Non-equivalent prefill acknowledgement", "Prefill failed", "Retained tail changed during compaction",
          "System prompt or tools changed during compaction", "Compaction failed",
          "Requested compactor did not supply the checkpoint", "Native summary exceeded the common text budget",
          "Probe or request contract failed", "Shared evidence archive changed",
        ]);
        if (error instanceof Error && known.has(error.message)) row.failure = error.message;
        throw error;
      } finally {
        session?.dispose();
        await Promise.allSettled(pending);
        runtime.streamSimple = originalStream; runtime.complete = originalComplete; runtime.classify = originalClassify;
        row.usage = summarizeUsage(calls);
        row.compactionUsage = summarizeUsage(calls.filter(call => call.kind === "compaction" || call.kind === "classifier"));
        row.prefixAudit = manager.getBranch().filter(entry => entry.type === "custom" && entry.customType === PREFIX_COMPACTION)
          .map(entry => entry.type === "custom" ? entry.data : undefined);
        if (row.status !== "complete") {
          row.status = "failed"; row.failurePhase = phase;
          row.failure ??= contractFailure ?? "Operation or checkpoint contract failed";
        }
        await writeFile(join(root, "partial.json"), JSON.stringify({ plan, rows }, null, 2), { mode: 0o600 });
      }
    }
  } catch { failure = "Experiment failed; inspect recorded phase, usage availability and completed rows."; }
  finally {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
  }
  const liveSettingsUnchanged = hash(await readFile(liveSettingsPath, "utf8")) === settingsHash;
  const report = { status: failure || !liveSettingsUnchanged ? "failed" : "complete", failure,
    root, model: options.model, thinking: options.thinking, liveSettingsUnchanged, plan, rows };
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  return report;
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Map(argv.filter(arg => arg.startsWith("--") && arg.includes("=")).map(arg => {
    const index = arg.indexOf("=");
    return [arg.slice(0, index), arg.slice(index + 1)];
  }));
  for (const arg of argv)
    if (arg !== "--run" && !/^--(?:model|thinking|seeds)=.+$/u.test(arg))
      throw Error("Unknown comparison argument");
  const options: ComparisonOptions = {
    model: flags.get("--model") ?? "gpt-6-luna-fast",
    thinking: "max", seeds: Number(flags.get("--seeds") ?? 2), includeNative: true,
  };
  const thinking = flags.get("--thinking") ?? "max";
  const checkedThinking = THINKING_LEVELS.find(level => level === thinking);
  if (!checkedThinking) throw Error("Unsupported thinking level");
  options.thinking = checkedThinking;
  const result = argv.includes("--run") ? await runComparison(options) : preflight(options);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "failed") process.exitCode = 1;
}
if (import.meta.main) await main();
