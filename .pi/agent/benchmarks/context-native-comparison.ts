import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  createAgentSession, createToolSearchExtension, DEFAULT_COMPACTION_SETTINGS,
  DefaultResourceLoader, estimateTokens, getAgentDir, ModelRuntime, SessionManager,
  SettingsManager, type AgentSession, type ExtensionFactory, type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import {
  CLASSIFIER_DEFAULTS, classifyCompaction, type ClassifierResponse,
} from "../extensions/context-masking/classifier-compaction";
import { CLASSIFIER_CHECKPOINT, isClassifierCheckpoint } from "../extensions/context-masking/classifier-hook";
import { isHybridCheckpoint } from "../extensions/context-masking/hybrid-summary";
import contextMasking from "../extensions/context-masking/index";
import { DEFAULT_SETTINGS, placeholder, selectMasks } from "../extensions/context-masking/policy";
import { autonomousStages, scoreStagedRecall } from "./context-classifier-autonomous-history";
import { assistant } from "./context-masking-recall-probe";

export const PREFLIGHT_ROOT = "/tmp/context-native-comparison-preflight";
export const SEEDS = ["paired-1", "paired-2", "paired-3"] as const;
export const ARMS = ["native-pi-summary", "enabled-classifier"] as const;
export const HYBRID_ARMS = ["native-pi-summary", "hybrid-summary"] as const;
export const RECALL_ABLATION_ARMS = ["native-recall", "hybrid-summary"] as const;
export const RECALL_ABLATION_SEEDS = ["recall-holdout-1", "recall-holdout-2", "recall-holdout-3"] as const;
export const FOUR_WAY_ARMS = ["native-pi-summary", "native-recall", "enabled-classifier", "hybrid-summary"] as const;
export const FOUR_WAY_SEEDS = ["fourway-holdout-1", "fourway-holdout-2", "fourway-holdout-3"] as const;
const MODEL = ["openai-codex", "gpt-6.1-sol"] as const;
const CLASSIFIER = { ...CLASSIFIER_DEFAULTS, enabled: true, includeContent: true, maxOutputBytes: 4_000 };
const LIMITS = { modelPerCompaction: 2, classifierPerCompaction: 40, modelPerProbe: 12, toolOverheadPerProbe: 12, operationMs: 180_000, campaignMs: 900_000 };
type Arm = typeof ARMS[number] | typeof HYBRID_ARMS[number] | typeof RECALL_ABLATION_ARMS[number];
interface ComparisonOptions { hybrid?: boolean; recallAblation?: boolean; fourWay?: boolean }
function comparison(options: ComparisonOptions) {
  if ([options.hybrid, options.recallAblation, options.fourWay].filter(Boolean).length > 1) throw Error("Choose one comparison variant");
  return {
    arms: options.fourWay ? FOUR_WAY_ARMS : options.recallAblation ? RECALL_ABLATION_ARMS : options.hybrid ? HYBRID_ARMS : ARMS,
    seeds: options.fourWay ? FOUR_WAY_SEEDS : options.recallAblation ? RECALL_ABLATION_SEEDS : SEEDS,
  };
}
function orderedArms(arms: readonly Arm[], seedIndex: number) {
  const offset = seedIndex % arms.length;
  return [...arms.slice(offset), ...arms.slice(0, offset)];
}
type Preparation = SessionBeforeCompactEvent["preparation"];
type Usage = NonNullable<ClassifierResponse["usage"]>;
type Model = NonNullable<ReturnType<ModelRuntime["getModel"]>>;
interface Fixture {
  cwd: string; agentDir: string; manager: SessionManager;
  manifest: Map<string, string>; artifacts: Map<string, string>;
  stages: ReturnType<typeof autonomousStages>; traceIds: string[];
}
interface Call {
  seed: string; arm: Arm; phase: number; kind: "summary" | "classifier" | "probe";
  ms: number; usage?: Usage; stopReason?: string; error?: string;
}
interface State {
  seed: string; arm: Arm; phase: number; probing: boolean; dry: boolean;
  modelCalls: number; classifierCalls: number; toolCalls: number;
  fatal?: string; probeFailure?: string; preparation?: Preparation; before?: ReturnType<typeof snapshot>;
}
const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
function classifierSettings(arm: Arm) {
  return { ...CLASSIFIER, enabled: arm === "enabled-classifier" || arm === "hybrid-summary", mode: arm === "hybrid-summary" ? "hybrid" as const : "extractive" as const };
}
function route(details: unknown, arm: Arm) {
  return isHybridCheckpoint(details) ? "hybrid" : isClassifierCheckpoint(details) ? "classifier" : classifierSettings(arm).enabled ? "fallback" : "native";
}
function settings(arm: Arm) {
  return {
    packages: [], extensions: [], defaultTools: ["read", "tool_search"],
    // Manual checkpoints isolate compaction behavior; native retention and prompts stay unchanged.
    compaction: { ...DEFAULT_COMPACTION_SETTINGS, enabled: false },
    retry: { enabled: false },
    contextMasking: { ...DEFAULT_SETTINGS, enabled: arm !== "native-pi-summary", prefetchRecall: arm !== "native-pi-summary" },
    contextClassifierCompaction: classifierSettings(arm),
    compactionModel: { enabled: false, model: MODEL.join("/"), thinkingLevel: "off" },
  };
}

export async function assertManifestRead(root: string, manifest: ReadonlySet<string>, requested: string) {
  if (!requested || requested.includes("\0") || requested.includes("\\") || requested.split("/").includes(".."))
    throw Error("Invalid workspace read path");
  const base = resolve(root);
  const rel = isAbsolute(requested) ? relative(base, requested) : requested;
  if (!manifest.has(rel)) throw Error("Read outside the exact workspace manifest");
  let path = base;
  for (const part of ["", ...rel.split("/")]) {
    path = part ? join(path, part) : path;
    if ((await lstat(path)).isSymbolicLink()) throw Error("Symlinked workspace read");
  }
  const file = await realpath(join(base, rel));
  if (file !== join(await realpath(base), rel) || !(await lstat(file)).isFile()) throw Error("Escaped workspace read");
}
async function fixture(root: string, seed: string): Promise<Fixture> {
  const cwd = join(root, "workspace"), agentDir = join(root, "agent");
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const stages = autonomousStages(seed), manifest = new Map<string, string>();
  for (const [phase, stage] of stages.entries()) {
    await mkdir(join(cwd, "reports", "phase-" + phase), { recursive: true, mode: 0o700 });
    for (const [i, value] of stage.outputs.entries()) {
      const name = "reports/phase-" + phase + "/scan-" + i + ".txt";
      await writeFile(join(cwd, name), value, { mode: 0o400, flag: "wx" });
      manifest.set(name, digest(value));
    }
  }
  return { cwd, agentDir, manager: SessionManager.inMemory(cwd), stages, manifest, artifacts: new Map(), traceIds: [] };
}
async function workspaceHash(f: Fixture) {
  const rows = [];
  for (const [path, hash] of f.manifest) {
    await assertManifestRead(f.cwd, new Set(f.manifest.keys()), path);
    if (digest(await readFile(join(f.cwd, path))) !== hash) throw Error("Source changed: " + path);
    rows.push([path, hash]);
  }
  return digest(JSON.stringify(rows));
}
async function artifactsPreserved(f: Fixture) {
  for (const [path, hash] of f.artifacts)
    if ((await lstat(path)).isSymbolicLink() || digest(await readFile(path)) !== hash) return false;
  return true;
}
async function appendStage(f: Fixture, phase: number, arm: Arm) {
  const stage = f.stages[phase];
  if (!stage) throw Error("Missing synthetic stage");
  f.manager.appendMessage({ role: "user", content: stage.goal, timestamp: phase });
  for (const [i, text] of stage.outputs.entries()) {
    const id = "phase-" + phase + "-read-" + i;
    f.manager.appendMessage(assistant([{ type: "toolCall", id, name: "read", arguments: { path: "reports/phase-" + phase + "/scan-" + i + ".txt" } }]));
    f.manager.appendMessage({ role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text }], isError: false, timestamp: phase });
  }
  const calls = Array.from({ length: 10 }, (_, i) =>
    assistant([{ type: "toolCall", id: "phase-" + phase + "-trace-" + i, name: "trace_batch", arguments: { synthetic: true, phase, chunk: i } }]));
  // Cross the retention budget at an assistant call, not inside a tool result.
  // Pi can then retain an intact call/result tail and all ten calls stay mask-protected.
  const resultTokens = DEFAULT_COMPACTION_SETTINGS.keepRecentTokens - sum(calls.slice(1).map(estimateTokens)) + 1;
  for (const [i, call] of calls.entries()) {
    f.manager.appendMessage(call);
    const tokens = Math.floor(resultTokens / 9) + (i <= resultTokens % 9 ? 1 : 0);
    const line = "synthetic background trace completed without task decisions\n";
    const size = i === 0 ? line.length : tokens * 4;
    const text = line.repeat(Math.ceil(size / line.length)).slice(0, size);
    const entry = f.manager.appendMessage({ role: "toolResult", toolCallId: "phase-" + phase + "-trace-" + i, toolName: "trace_batch", content: [{ type: "text", text }], isError: false, timestamp: phase });
    if (i === 9) f.traceIds.push(entry);
  }
  if (arm !== "native-pi-summary") {
    // shortcut: prepare historical masks. Measure automatic lifecycle separately before tuning triggerRatio from these results.
    const masks = selectMasks(f.manager.buildSessionProjection().entries, DEFAULT_SETTINGS);
    const root = join(f.agentDir, "cache", "context-masking", f.manager.getSessionId());
    await mkdir(root, { recursive: true, mode: 0o700 });
    const items = [];
    for (const mask of masks) {
      const path = join(root, mask.entryId + ".txt");
      await writeFile(path, mask.text, { mode: 0o600, flag: "wx" });
      f.artifacts.set(path, digest(mask.text));
      f.manager.appendContextEdit(mask.entryId, { content: [{ type: "text", text: placeholder(mask, path) }] });
      items.push({ entryId: mask.entryId, toolName: mask.toolName, path });
    }
    f.manager.appendCustomEntry("context-masking", { items });
  }
}
function snapshot(f: Fixture, p: Preparation, phase: number) {
  const entries = f.manager.buildSessionProjection().entries;
  const index = entries.findIndex(e => e.sourceEntry.id === p.firstKeptEntryId);
  if (index < 0) throw Error("Missing native cut point");
  const tail = entries.slice(index);
  const prefix = [...p.messagesToSummarize, ...p.turnPrefixMessages];
  const prefixText = JSON.stringify(prefix);
  const evidence = prefix.filter(m => m.role === "toolResult" && m.toolName === "read").length;
  if (!evidence || !tail.some(e => e.sourceEntry.id === f.traceIds[phase])) throw Error("Fixture split failed: phase=" + phase + " evidence=" + evidence + " traceInTail=" + tail.some(e => e.sourceEntry.id === f.traceIds[phase]) + " prefixRoles=" + prefix.map(m => m.role).join(","));
  const tailTokens = sum(tail.flatMap(e => e.messages).map(estimateTokens));
  if (tailTokens < DEFAULT_COMPACTION_SETTINGS.keepRecentTokens) throw Error("Native retained tail below default");
  for (const stage of f.stages) for (const q of stage.probes)
    if (prefixText.includes(q.question)) throw Error("Probe leaked into compacted history");
  return { phase: phase + 1, inputTokens: p.tokensBefore, firstKeptEntryId: p.firstKeptEntryId, retainedTailTokens: tailTokens, tailContainsTraceBatch: true, prefixFactEvidence: evidence };
}
async function session(runtime: ModelRuntime, model: Model, f: Fixture, state: State) {
  const observer: ExtensionFactory = pi => {
    pi.on("session_before_compact", event => {
      state.preparation = event.preparation;
      if (state.dry) return { cancel: true };
      state.before = snapshot(f, event.preparation, state.phase);
      if (event.preparation.tokensBefore + DEFAULT_COMPACTION_SETTINGS.reserveTokens >= model.contextWindow)
        throw Error("Projected fixture exceeds model context window");
      return undefined;
    });
    pi.on("tool_call", async (event, ctx) => {
      state.toolCalls++;
      try {
        if (state.toolCalls > f.manifest.size + LIMITS.toolOverheadPerProbe) throw Error("Full-manifest tool-call limit");
        if (event.toolName === "read") {
          const path = event.input.path;
          if (typeof path !== "string") throw Error("Invalid read path");
          const artifactRoot = join(f.agentDir, "cache", "context-masking");
          const knownArtifact = state.arm !== "native-pi-summary" && f.artifacts.has(resolve(f.cwd, path));
          await assertManifestRead(knownArtifact ? artifactRoot : f.cwd,
            new Set(knownArtifact ? [...f.artifacts.keys()].map(p => relative(artifactRoot, p)) : f.manifest.keys()), path);
          event.input.limit = 80;
        } else if (event.toolName !== "tool_search" && !(state.arm !== "native-pi-summary" && event.toolName === "recall"))
          throw Error("Out-of-scope tool: " + event.toolName);
      } catch (error) {
        state.fatal = String(error); ctx.abort();
        return { block: true, terminate: true, reason: "Only bounded fixture reads, discovery and candidate recall are permitted." };
      }
      return undefined;
    });
  };
  const config = settings(state.arm), memory = SettingsManager.inMemory(config);
  const loader = new DefaultResourceLoader({
    cwd: f.cwd, agentDir: f.agentDir, settingsManager: memory,
    noExtensions: true, noContextFiles: true, noSkills: true, noThemes: true, noPromptTemplates: true,
    extensionFactories: [observer, createToolSearchExtension(), ...(!state.dry && state.arm !== "native-pi-summary" ? [contextMasking] : [])],
  });
  await loader.reload();
  if (loader.getExtensions().errors.length) throw Error("Extension loading failed");
  const { session: s } = await createAgentSession({ cwd: f.cwd, agentDir: f.agentDir, modelRuntime: runtime, model, thinkingLevel: "off", settingsManager: memory, sessionManager: f.manager, resourceLoader: loader });
  await s.bindExtensions({ onError: error => { state.fatal = error.error; s.agent.abort(); s.abortCompaction(); } });
  return s;
}
async function models(root: string, offline: boolean) {
  const runtime = await ModelRuntime.create(offline ? { authPath: join(root, "auth.json"), refreshOnCreate: false, allowModelNetwork: false } : { refreshOnCreate: false, allowModelNetwork: false });
  const answer = runtime.getModel(...MODEL), classifier = runtime.getModelOfType("classifier", CLASSIFIER.provider, CLASSIFIER.model);
  if (!answer || !classifier) throw Error("Required comparison models unavailable");
  return { runtime, answer, classifier };
}
function clearPreparation(state: State) {
  delete state.preparation;
  delete state.before;
}
function newState(seed: string, arm: Arm, dry = false): State {
  return { seed, arm, phase: 0, probing: false, dry, modelCalls: 0, classifierCalls: 0, toolCalls: 0 };
}
export async function buildPreflight(options: ComparisonOptions & { root: string; answerContextWindow?: number; classifierContextWindow?: number }) {
  await mkdir(options.root, { recursive: true, mode: 0o700 });
  const { runtime, answer, classifier } = await models(options.root, true);
  let attempts = 0;
  runtime.streamSimple = () => { attempts++; throw Error("Provider call during offline preflight"); };
  runtime.classify = async () => { attempts++; throw Error("Classifier call during offline preflight"); };
  const arms = [];
  const { arms: comparisonArms, seeds } = comparison(options);
  for (const seed of seeds) for (const arm of comparisonArms) {
    const f = await fixture(join(options.root, seed, arm), seed), state = newState(seed, arm, true), compactions = [];
    for (let phase = 0; phase < 3; phase++) {
      state.phase = phase; await appendStage(f, phase, arm);
      const s = await session(runtime, answer, f, state);
      try { await s.compact(); } catch (error) {
        if (!(error instanceof Error) || !/cancel/i.test(error.message) || !state.preparation) throw error;
      } finally { s.dispose(); }
      const p = state.preparation;
      if (!p) throw Error("Native preparation not observed");
      const row = snapshot(f, p, phase), requests: Array<{ bytes: number; questions: number }> = [];
      if (classifierSettings(arm).enabled) await classifyCompaction({
        branch: f.manager.getBranch(), messages: [...p.messagesToSummarize, ...p.turnPrefixMessages],
        ...(p.previousSummary ? { previousSummary: p.previousSummary } : {}),
      }, classifierSettings(arm), {
        artifactRoot: join(f.agentDir, "cache", "context-masking"),
        classify: async request => {
          requests.push({ bytes: Buffer.byteLength(JSON.stringify(request)), questions: Object.keys(request.questions).length });
          const answers: ClassifierResponse["answers"] = {};
          for (const key of Object.keys(request.questions)) answers[key] = { type: "bool", probability: 0.5 };
          return { api: classifier.api, provider: classifier.provider, model: classifier.id, answers, stopReason: "stop", timestamp: 0 };
        },
      });
      compactions.push({ ...row, classifierRequests: requests });
      // Later live checkpoints are revalidated; this placeholder is not an observed model result.
      f.manager.appendCompaction("[offline placeholder: no summary model called]", p.firstKeptEntryId, p.tokensBefore);
    }
    const window = options.answerContextWindow ?? answer.contextWindow;
    if (compactions.some(r => r.inputTokens + DEFAULT_COMPACTION_SETTINGS.reserveTokens >= window)) throw Error("Preflight exceeds answer context window");
    if (!(await artifactsPreserved(f))) throw Error("Preflight changed saved artifacts");
    arms.push({ seed, arm, workspaceHash: await workspaceHash(f), artifactCount: f.artifacts.size, contextWindow: window, compactions });
  }
  if (attempts) throw Error("Offline preflight attempted provider calls");
  return {
    networkCalls: attempts, lifecycle: "manual checkpoints; prepared-masked-history; automatic thresholds not measured",
    config: { seeds, armSettings: Object.fromEntries(comparisonArms.map(arm => [arm, settings(arm)])), stages: 3, compaction: DEFAULT_COMPACTION_SETTINGS, answerModel: MODEL,
      order: seeds.map((seed, index) => ({ seed, arms: orderedArms(comparisonArms, index) })),
      classifierContextWindow: options.classifierContextWindow ?? classifier.contextWindow, classifier: classifierSettings(options.fourWay ? "hybrid-summary" : comparisonArms[1]), limits: LIMITS,
      maximumRequests: {
        model: seeds.length * comparisonArms.length * (3 * LIMITS.modelPerCompaction + LIMITS.modelPerProbe),
        classifier: seeds.length * comparisonArms.filter(arm => classifierSettings(arm).enabled).length * 3 * LIMITS.classifierPerCompaction,
      }, retries: false, thinkingLevel: "off" },
    arms,
  };
}
export async function runComparison(root: string, options: ComparisonOptions = {}) {
  const { arms: comparisonArms, seeds } = comparison(options);
  const live = join(getAgentDir(), "settings.json"), before = digest(await readFile(live));
  const { runtime, answer } = await models(root, false);
  const calls: Call[] = [], pending: Promise<void>[] = [], rows: Array<Record<string, unknown>> = [];
  let active: State | undefined;
  const started = performance.now(), stream = runtime.streamSimple.bind(runtime), classify = runtime.classify.bind(runtime);
  function check(kind: "model" | "classifier") {
    const s = active;
    if (!s || s.fatal || performance.now() - started > LIMITS.campaignMs) throw Error(s?.fatal ?? "Campaign request guard");
    if (kind === "classifier" && !classifierSettings(s.arm).enabled) {
      s.fatal = "Classifier request from disabled arm: " + s.arm;
      throw Error(s.fatal);
    }
    if (kind === "model" && ++s.modelCalls > (s.probing ? LIMITS.modelPerProbe : LIMITS.modelPerCompaction)) {
      if (s.probing) s.probeFailure = "model-request-limit";
      throw Error("Model-request budget exceeded");
    }
    if (kind === "classifier" && ++s.classifierCalls > LIMITS.classifierPerCompaction) throw Error("Classifier-request budget exceeded");
    return s;
  }
  runtime.streamSimple = (model, context, options) => {
    const s = check("model"), call: Call = { seed: s.seed, arm: s.arm, phase: s.phase + 1, kind: s.probing ? "probe" : "summary", ms: 0 };
    calls.push(call); const start = performance.now(), result = stream(model, context, options);
    pending.push(result.result().then(message => {
      call.ms = performance.now() - start; call.usage = message.usage; call.stopReason = message.stopReason;
      if (message.stopReason === "error" || message.stopReason === "aborted") { call.error = message.errorMessage ?? message.stopReason; s.fatal = call.error; }
    }).catch(error => { call.error = String(error); s.fatal = call.error; }));
    return result;
  };
  runtime.classify = async (model, context, options) => {
    const s = check("classifier"), call: Call = { seed: s.seed, arm: s.arm, phase: s.phase + 1, kind: "classifier", ms: 0 };
    calls.push(call); const start = performance.now();
    try {
      const result = await classify(model, context, options);
      if (result.usage) call.usage = result.usage;
      call.stopReason = result.stopReason;
      if (result.stopReason !== "stop") call.error = result.errorMessage ?? result.stopReason;
      return result;
    } catch (error) { call.error = String(error); throw error; }
    finally { call.ms = performance.now() - start; }
  };
  const previous = process.env.PI_CODING_AGENT_DIR;
  let failure: string | undefined;
  try {
    for (const [index, seed] of seeds.entries()) for (const arm of orderedArms(comparisonArms, index)) {
      const f = await fixture(join(root, "measured", seed, arm), seed), state = newState(seed, arm);
      process.env.PI_CODING_AGENT_DIR = f.agentDir;
      await writeFile(join(f.agentDir, "settings.json"), JSON.stringify(settings(arm), null, 2));
      const compactions: Array<ReturnType<typeof snapshot> & { ms: number; maskPreparationMs: number; bytes: number; outcome: string; details: unknown; audit: unknown; calls: Call[] }> = [];
      const armRow: Record<string, unknown> = { seed, arm, workspaceHash: await workspaceHash(f), compactions };
      rows.push(armRow);
      for (let phase = 0; phase < 3; phase++) {
        state.phase = phase; state.modelCalls = 0; state.classifierCalls = 0;
        clearPreparation(state);
        const prepStart = performance.now(); await appendStage(f, phase, arm);
        const maskPreparationMs = performance.now() - prepStart;
        const s = await session(runtime, answer, f, state), firstCall = calls.length, start = performance.now();
        active = state;
        const branchBefore = f.manager.getBranch().length;
        const timer = setTimeout(() => { state.fatal = "Compaction deadline"; s.abortCompaction(); }, Math.max(1, Math.min(LIMITS.operationMs, LIMITS.campaignMs - (performance.now() - started))));
        try {
          const result = await s.compact(); await Promise.all(pending);
          if (state.fatal || !state.preparation || !state.before) throw Error(state.fatal ?? "Missing native preparation");
          const checkpoint = f.manager.getBranch().filter(e => e.type === "compaction").at(-1);
          if (checkpoint?.type !== "compaction") throw Error("Missing committed checkpoint");
          compactions.push({ ...state.before, ms: performance.now() - start, maskPreparationMs,
            bytes: Buffer.byteLength(result.summary), outcome: route(checkpoint.details, arm),
            details: checkpoint.details, audit: f.manager.getBranch().slice(branchBefore).filter(e => e.type === "custom" && e.customType === CLASSIFIER_CHECKPOINT).map(e => e.type === "custom" ? e.data : undefined), calls: calls.slice(firstCall) });
          await writeFile(join(f.agentDir, "checkpoint-" + (phase + 1) + ".json"), JSON.stringify(checkpoint, null, 2));
          console.error(JSON.stringify({ seed, arm, phase: phase + 1, outcome: route(checkpoint.details, arm), ms: compactions.at(-1)?.ms }));
        } finally { clearTimeout(timer); s.dispose(); }
        if (!(await artifactsPreserved(f))) throw Error("Saved artifact changed");
        if (await workspaceHash(f) !== armRow.workspaceHash) throw Error("Workspace evidence changed");
      }
      state.probing = true; state.modelCalls = 0; state.classifierCalls = 0; state.toolCalls = 0;
      const s = await session(runtime, answer, f, state), firstCall = calls.length, start = performance.now();
      active = state;
      const timer = setTimeout(() => { state.fatal = "Probe deadline"; s.agent.abort(); }, Math.max(1, Math.min(LIMITS.operationMs, LIMITS.campaignMs - (performance.now() - started))));
      try {
        await s.prompt("Answer as one JSON object with exactly these IDs. Use exact recorded strings, or null when unavailable. Prefer latest approvals; do not guess.\n" +
          JSON.stringify(f.stages[2]?.probes.map(({ id, question }) => ({ id, question }))));
        await Promise.all(pending);
        if (state.fatal) throw Error(state.fatal);
        const answerText = s.getLastAssistantText() ?? "";
        const last = [...s.agent.state.messages].reverse().find(m => m.role === "assistant");
        armRow.probe = { ms: performance.now() - start, answer: answerText, score: scoreStagedRecall(f.stages, 2, answerText),
          failure: state.probeFailure, finalStopReason: last?.role === "assistant" ? last.stopReason : undefined,
          finalError: last?.role === "assistant" ? last.errorMessage : undefined,
          toolCalls: state.toolCalls, toolCallLimit: f.manifest.size + LIMITS.toolOverheadPerProbe, manifestFiles: f.manifest.size, calls: calls.slice(firstCall),
          prefetch: s.agent.state.messages.some(m => "customType" in m && m.customType === "context-masking-recall") };
        armRow.artifactsPreserved = await artifactsPreserved(f);
        armRow.artifactCount = f.artifacts.size;
        armRow.workspaceHashAfter = await workspaceHash(f);
        if (!armRow.artifactsPreserved || armRow.workspaceHashAfter !== armRow.workspaceHash) throw Error("Final integrity check failed");
      } finally { clearTimeout(timer); s.dispose(); }
      await writeFile(join(root, "partial.json"), JSON.stringify({ rows, calls }, null, 2));
    }
  } catch (error) { failure = String(error); }
  finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    runtime.streamSimple = stream; runtime.classify = classify;
  }
  const after = digest(await readFile(live));
  if (after !== before) failure ??= "Live settings changed";
  const report = { status: failure ? "failed" : "complete", failure, root, model: MODEL, seeds,
    lifecycle: "Manual compactions; native default retention/prompts; prepared historical masks where enabled; automatic trigger thresholds not measured",
    controls: { limits: LIMITS, compaction: DEFAULT_COMPACTION_SETTINGS, candidate: classifierSettings(options.fourWay ? "hybrid-summary" : comparisonArms[1]), arms: Object.fromEntries(comparisonArms.map(arm => [arm, settings(arm)])), imposedWaitMs: 0, automaticCompaction: false, retries: false, thinkingLevel: "off",
      order: seeds.map((seed, index) => ({ seed, arms: orderedArms(comparisonArms, index) })),
      cachePolicy: "Fresh sessions, no warmup; provider cache uncontrolled and usage recorded" },
    pricing: "usage.cost is SDK-reported/catalog pricing only. Actual Codex subscription dollar cost is unknown; do not chart as zero or claim dollar savings.",
    liveSettingsUnchanged: before === after, settingsDigestBefore: before, settingsDigestAfter: after, rows, calls };
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
  if (failure) throw Error(failure + "; partial report: " + join(root, "report.json"));
  return report;
}
async function main() {
  await mkdir(PREFLIGHT_ROOT, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(PREFLIGHT_ROOT, "cohort-"));
  console.error(JSON.stringify({ root }));
  const options = { hybrid: process.argv.includes("--hybrid"), recallAblation: process.argv.includes("--recall-ablation"), fourWay: process.argv.includes("--four-way") };
  const preflight = await buildPreflight({ root: join(root, "preflight"), ...options });
  await writeFile(join(root, "preflight.json"), JSON.stringify(preflight, null, 2));
  console.log(JSON.stringify({ root, preflight }));
  if (process.argv.includes("--run")) console.log(JSON.stringify(await runComparison(root, options)));
}
if (import.meta.main) main().catch(error => { console.error(error); process.exitCode = 1; });
