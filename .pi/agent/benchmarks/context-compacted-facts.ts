import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import {
  createAgentSession,
  createToolSearchExtension,
  DEFAULT_COMPACTION_SETTINGS,
  DefaultResourceLoader,
  type ExtensionFactory,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { openProfileCredentials } from "../extensions/auth-profiles/profile-credentials";
import { resolveProfile } from "../extensions/auth-profiles/profile-resolver";
import { selectProfile } from "../extensions/auth-profiles/profile-selector";
import { projectIsTrusted } from "../extensions/auth-profiles/project-trust";
import { createOpenAiCodexProfileAdapter } from "../extensions/auth-profiles/providers/openai-codex";
import {
  isClassifierCheckpoint,
  parseClassifierSettings,
} from "../extensions/context-masking/classifier-hook";
import {
  readTextArtifact,
  recallableTextArchiveRecords,
} from "../extensions/context-masking/evidence-archive";
import contextMasking from "../extensions/context-masking/index";
import { DEFAULT_SETTINGS } from "../extensions/context-masking/policy";
import { RECALL_CLASSIFIER_TASK, RECALL_PREFETCH_TASK } from "../extensions/context-masking/recall";
import openaiCapabilities, {
  applyFastServiceTierForPayload,
} from "../extensions/openai-capabilities";
import {
  type CompactedCorpus,
  type CompactedProbe,
  type CorpusScenario,
  compactedFactCorpus,
  messageEvidenceText,
  probeEvidencePresent,
  scoreCompactedProbes,
  selectCompactedQuestions,
  summarizeFactDimensions,
} from "./context-compacted-fact-fixtures";
import { assistant } from "./context-masking-recall-probe";
import { assertManifestRead, finalProbeRequest } from "./context-native-comparison";

const LIMITS = {
  modelRequests: 8,
  classifierRequests: 80,
  toolCalls: 24,
  operationMs: 180_000,
  campaignMs: 900_000,
};
const ARMS = ["combined", "explicit-only"] as const;
type Arm = (typeof ARMS)[number];
type Usage = Awaited<ReturnType<ModelRuntime["completeSimple"]>>["usage"];
interface Call {
  seed: string;
  phase: "compaction" | "probe";
  arm?: Arm;
  batch?: number;
  kind: string;
  provider: string;
  model: string;
  ms: number;
  usage?: Usage;
  stopReason?: string;
  error?: string;
}
interface Operation {
  seed: string;
  phase: "compaction" | "probe";
  arm?: Arm;
  batch?: number;
  modelRequests: number;
  classifierRequests: number;
  toolCalls: number;
  failure?: string;
  forcedFinal: boolean;
  prefixFacts?: number;
  probes: CompactedProbe[];
  toolTrace: Array<{ tool: string; input: unknown; blocked: boolean }>;
  modelInputs: Array<{ messages: number; chars: number; answersPresent: string[] }>;
}
interface ProbeRow {
  seed: string;
  arm: Arm;
  batch: number;
  status: "complete" | "failed";
  failure?: string;
  score: ReturnType<typeof scoreCompactedProbes>;
  modelRequests: number;
  classifierRequests: number;
  toolCalls: number;
  forcedFinal: boolean;
  prefetchedFacts: number;
  prefetchFalsePositives: number;
  tracePath: string;
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const save = (path: string, value: unknown) =>
  writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 });
const operation = (seed: string, phase: Operation["phase"]): Operation => ({
  seed,
  phase,
  modelRequests: 0,
  classifierRequests: 0,
  toolCalls: 0,
  forcedFinal: false,
  probes: [],
  toolTrace: [],
  modelInputs: [],
});

function appendHistory(manager: SessionManager, corpus: CompactedCorpus) {
  manager.appendMessage({
    role: "user",
    content:
      "Review these historical service audit records. No implementation changes are pending.",
    timestamp: 0,
  });
  for (const [index, archive] of corpus.archives.entries()) {
    const id = `audit-${index}`;
    manager.appendMessage(
      assistant([{ type: "toolCall", id, name: archive.tool, arguments: archive.args }]),
    );
    manager.appendMessage({
      role: "toolResult",
      toolCallId: id,
      toolName: archive.tool,
      content: [{ type: "text", text: archive.text }],
      isError: false,
      timestamp: index,
    });
  }
  // Put every fact before Pi's native retained tail without changing the retention policy.
  const chars = Math.ceil(((DEFAULT_COMPACTION_SETTINGS.keepRecentTokens + 2_000) * 4) / 10);
  const line = "Background trace finished; no service decisions were made.\n";
  for (let index = 0; index < 10; index++) {
    const id = `background-${index}`;
    manager.appendMessage(
      assistant([{ type: "toolCall", id, name: "trace_batch", arguments: { index } }]),
    );
    manager.appendMessage({
      role: "toolResult",
      toolCallId: id,
      toolName: "trace_batch",
      content: [
        { type: "text", text: line.repeat(Math.ceil(chars / line.length)).slice(0, chars) },
      ],
      isError: false,
      timestamp: 1_000 + index,
    });
  }
  manager.appendMessage(assistant([{ type: "text", text: "Historical audit review finished." }]));
}

function promptFor(probes: readonly CompactedProbe[]) {
  return (
    "Answer these historical questions as one JSON object with exactly the listed IDs. " +
    "Use the exact recorded strings, or null when no supporting evidence is available. " +
    "Prefer the latest approval and do not guess.\n\n" +
    probes.map((probe) => `- ${probe.id}: ${probe.question}`).join("\n")
  );
}

export async function runCompactedFacts(
  seeds: string[],
  questionCount: number,
  run: boolean,
  scenario: CorpusScenario = "receipt",
) {
  const originalAgentDir = getAgentDir();
  const liveSettingsPath = join(originalAgentDir, "settings.json");
  const liveSettingsHash = digest(await readFile(liveSettingsPath, "utf8"));
  const global = SettingsManager.create(process.cwd(), originalAgentDir, { projectTrusted: false });
  if (global.drainErrors().length) throw new Error("Cannot load evaluation model settings");
  const inherited = Boolean(process.env.PI_PROVIDER && process.env.PI_MODEL);
  const provider = inherited ? process.env.PI_PROVIDER : global.getDefaultProvider();
  const modelId = inherited ? process.env.PI_MODEL : global.getDefaultModel();
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
  const requestedThinking = inherited ? process.env.PI_REASONING_LEVEL : undefined;
  const thinking =
    requestedThinking === undefined
      ? (global.getDefaultThinkingLevel() ?? "off")
      : levels.find((level) => level === requestedThinking);
  if (!thinking) throw new Error("Invalid inherited reasoning level");
  if (!provider || !modelId) throw new Error("Configure an answering provider and model");
  const live: Record<string, unknown> = { ...global.getGlobalSettings() };
  const classifier = parseClassifierSettings(live);
  if (!classifier.enabled)
    throw new Error("This evaluation requires enabled classifier compaction");
  const config = {
    packages: [],
    extensions: [],
    defaultTools: ["read", "tool_search"],
    compaction: { ...DEFAULT_COMPACTION_SETTINGS, enabled: false },
    retry: { enabled: false },
    contextMasking: {
      ...DEFAULT_SETTINGS,
      enabled: true,
      rollingEnabled: false,
      prefetchRecall: true,
    },
    contextClassifierCompaction: classifier,
    compactionModel: live.compactionModel,
    classifier: live.classifier,
  };
  const profileContext = {
    cwd: process.cwd(),
    isProjectTrusted: () => projectIsTrusted(process.cwd(), originalAgentDir),
  };
  const adapter = createOpenAiCodexProfileAdapter(originalAgentDir);
  const selection = run
    ? await selectProfile(profileContext, { agentDir: originalAgentDir, providerAdapter: adapter })
    : await resolveProfile(profileContext, { agentDir: originalAgentDir });
  const campaignMs = LIMITS.campaignMs * seeds.length;
  const controls = {
    answeringModel: `${provider}/${modelId}`,
    thinking,
    modelSource: inherited ? "session-environment" : "global-settings",
    authProfile: selection.profile,
    authProfileSource: selection.source,
    compactionClassifier: `${classifier.provider}/${classifier.model}`,
    classifierSettings: classifier,
    seeds,
    scenario,
    corpusFacts: 1_000,
    questionsPerSeed: questionCount,
    arms: ARMS,
    limits: { ...LIMITS, campaignMs },
    lifecycle:
      "Seeded historical tool results; real manual SDK compaction; production recall/prefetch; automatic compaction and rolling masking disabled",
    selection:
      "After compaction: hidden facts only; balanced fact types and wording for diverse scenarios, with revision and chronology strata",
    isolation:
      "Each batch forks the same checkpoint; only saved archive reads are allowed; no original workspace files or answer keys are accessible",
  };
  if (!run) return { status: "plan" as const, controls, modelCalls: 0 };

  const root = await realpath(await mkdtemp(join(tmpdir(), "context-compacted-facts-")));
  console.error(JSON.stringify({ root, controls }));
  // Resolve credentials before redirecting the extension's artifact/settings directory.
  const credentials = await openProfileCredentials(
    adapter,
    selection.profile,
    selection.profileOrder,
  );
  const runtime = await ModelRuntime.create({
    credentials,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const model = runtime.getModel(provider, modelId);
  if (!model) throw new Error("Configured answering model is unavailable");
  const stream = runtime.streamSimple.bind(runtime);
  const classify = runtime.classify.bind(runtime);
  const pending: Promise<void>[] = [];
  const calls: Call[] = [];
  const rows: ProbeRow[] = [];
  const compactions: Array<Record<string, unknown>> = [];
  let active: Operation | undefined;
  const started = performance.now();
  const check = (kind: "model" | "classifier") => {
    if (!active) throw new Error("Provider request outside evaluation operation");
    const state = active;
    if (state.failure || performance.now() - started > campaignMs)
      throw new Error(state.failure ?? "Campaign deadline exceeded");
    const count = kind === "model" ? ++state.modelRequests : ++state.classifierRequests;
    if (count > (kind === "model" ? LIMITS.modelRequests : LIMITS.classifierRequests)) {
      state.failure = `${kind} request budget exceeded`;
      throw new Error(state.failure);
    }
    return state;
  };
  runtime.streamSimple = (selected, context, options) => {
    const state = check("model");
    const call: Call = {
      seed: state.seed,
      phase: state.phase,
      kind: state.phase === "probe" ? "answer" : "compaction-fallback",
      provider: selected.provider,
      model: selected.id,
      ms: 0,
      ...(state.arm ? { arm: state.arm } : {}),
      ...(state.batch === undefined ? {} : { batch: state.batch }),
    };
    calls.push(call);
    const text = JSON.stringify(context.messages);
    const evidence = messageEvidenceText(context.messages);
    state.modelInputs.push({
      messages: context.messages.length,
      chars: text.length,
      answersPresent: state.probes
        .filter((probe) => probeEvidencePresent(evidence, probe))
        .map((probe) => probe.id),
    });
    const final = state.phase === "probe" && state.modelRequests === LIMITS.modelRequests;
    state.forcedFinal ||= final;
    const request = final ? finalProbeRequest(context, options) : { context, options };
    const start = performance.now();
    const result = stream(selected, request.context, {
      ...request.options,
      onPayload: async (payload, selectedModel) => {
        const replacement = await request.options?.onPayload?.(payload, selectedModel);
        return applyFastServiceTierForPayload(replacement ?? payload) ?? replacement;
      },
    });
    pending.push(
      result
        .result()
        .then((message) => {
          call.ms = performance.now() - start;
          call.usage = message.usage;
          call.stopReason = message.stopReason;
          if (message.stopReason === "error" || message.stopReason === "aborted") {
            call.error = message.errorMessage ?? message.stopReason;
            state.failure = call.error;
          }
        })
        .catch((error: unknown) => {
          call.error = String(error);
          state.failure = call.error;
        }),
    );
    return result;
  };
  runtime.classify = async (selected, context, options) => {
    const state = check("classifier");
    const task = context.state.task;
    const call: Call = {
      seed: state.seed,
      phase: state.phase,
      kind:
        task === RECALL_PREFETCH_TASK
          ? "prefetch"
          : task === RECALL_CLASSIFIER_TASK
            ? "recall"
            : "compaction",
      provider: selected.provider,
      model: selected.id,
      ms: 0,
      ...(state.arm ? { arm: state.arm } : {}),
      ...(state.batch === undefined ? {} : { batch: state.batch }),
    };
    calls.push(call);
    const start = performance.now();
    try {
      const result = await classify(selected, context, options);
      if (result.usage) call.usage = result.usage;
      call.stopReason = result.stopReason;
      if (result.stopReason !== "stop") call.error = result.errorMessage ?? result.stopReason;
      return result;
    } catch (error) {
      call.error = String(error);
      throw error;
    } finally {
      call.ms = performance.now() - start;
    }
  };

  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  let failure: string | undefined;
  try {
    for (const [seedIndex, seed] of seeds.entries()) {
      const corpus = compactedFactCorpus(seed, scenario);
      const dir = join(root, seed),
        cwd = join(dir, "workspace"),
        agentDir = join(dir, "agent");
      await mkdir(cwd, { recursive: true, mode: 0o700 });
      await mkdir(agentDir, { recursive: true, mode: 0o700 });
      process.env.PI_CODING_AGENT_DIR = agentDir;
      const artifactRoot = join(agentDir, "cache", "context-masking");
      const manager = SessionManager.inMemory(cwd);
      appendHistory(manager, corpus);
      const openSession = async (state: Operation, prefetch: boolean) => {
        active = state;
        const settings = {
          ...config,
          contextMasking: { ...config.contextMasking, prefetchRecall: prefetch },
        };
        await save(join(agentDir, "settings.json"), settings);
        const memory = SettingsManager.inMemory(settings);
        const observer: ExtensionFactory = (pi) => {
          pi.on("session_before_compact", (event) => {
            const prefix = JSON.stringify([
              ...event.preparation.messagesToSummarize,
              ...event.preparation.turnPrefixMessages,
            ]);
            state.prefixFacts = corpus.facts.filter((fact) =>
              prefix.includes(fact.evidence),
            ).length;
            if (state.prefixFacts !== corpus.facts.length)
              throw new Error("Facts escaped the compaction prefix");
            if (
              event.preparation.tokensBefore + DEFAULT_COMPACTION_SETTINGS.reserveTokens >=
              model.contextWindow
            )
              throw new Error("Fixture exceeds the answering model context window");
          });
          pi.on("tool_call", async (event, ctx) => {
            const trace = {
              tool: event.toolName,
              input: structuredClone(event.input),
              blocked: false,
            };
            state.toolTrace.push(trace);
            state.toolCalls++;
            try {
              if (state.toolCalls > LIMITS.toolCalls) {
                state.failure = "Tool-call budget exceeded";
                ctx.abort();
                throw new Error(state.failure);
              }
              if (event.toolName === "read") {
                if (typeof event.input.path !== "string") throw new Error("Invalid archive path");
                const paths = new Set(
                  recallableTextArchiveRecords(manager.getBranch()).map((item) =>
                    relative(artifactRoot, item.path),
                  ),
                );
                await assertManifestRead(artifactRoot, paths, event.input.path);
                event.input.limit = 80;
              } else if (event.toolName !== "recall" && event.toolName !== "tool_search") {
                throw new Error(
                  "Only saved archive reads, recall and tool discovery are available",
                );
              }
            } catch (error) {
              trace.blocked = true;
              return {
                block: true,
                reason: error instanceof Error ? error.message : String(error),
              };
            }
            return undefined;
          });
        };
        const loader = new DefaultResourceLoader({
          cwd,
          agentDir,
          settingsManager: memory,
          noExtensions: true,
          noContextFiles: true,
          noSkills: true,
          noThemes: true,
          noPromptTemplates: true,
          extensionFactories: [
            openaiCapabilities,
            observer,
            createToolSearchExtension(),
            contextMasking,
          ],
        });
        await loader.reload();
        if (loader.getExtensions().errors.length)
          throw new Error("Evaluation extensions did not load");
        const { session } = await createAgentSession({
          cwd,
          agentDir,
          modelRuntime: runtime,
          model,
          thinkingLevel: thinking,
          settingsManager: memory,
          sessionManager: manager,
          resourceLoader: loader,
        });
        await session.bindExtensions({
          onError: (error) => {
            state.failure = error.error;
            session.agent.abort();
            session.abortCompaction();
          },
        });
        return session;
      };
      const compactState = operation(seed, "compaction");
      const compactSession = await openSession(compactState, true);
      const compactTimer = setTimeout(() => {
        compactState.failure = "Compaction deadline";
        compactSession.abortCompaction();
      }, LIMITS.operationMs);
      let compacted: Awaited<ReturnType<typeof compactSession.compact>>;
      try {
        compacted = await compactSession.compact();
        await Promise.all(pending);
        if (compactState.failure) throw new Error(compactState.failure);
      } finally {
        clearTimeout(compactTimer);
        compactSession.dispose();
      }
      const checkpoint = manager
        .getBranch()
        .filter((entry) => entry.type === "compaction")
        .at(-1);
      if (checkpoint?.type !== "compaction")
        throw new Error("No actual compaction checkpoint was committed");
      const baseId = manager.getLeafId();
      if (!baseId) throw new Error("No checkpoint branch");
      const visible = messageEvidenceText(manager.buildSessionProjection().messages);
      const records = recallableTextArchiveRecords(manager.getBranch());
      const readablePaths = new Set(records.map((record) => relative(artifactRoot, record.path)));
      for (const record of records)
        await assertManifestRead(artifactRoot, readablePaths, record.path);
      const archiveHashes = new Map<string, string>();
      const archivedValues = new Set<string>();
      for (const record of records) {
        const saved = await readTextArtifact(artifactRoot, record, 128 * 1024);
        if (saved.partial) throw new Error("Synthetic archive exceeds recall's per-file bound");
        archiveHashes.set(record.path, digest(saved.text));
        for (const fact of corpus.facts)
          if (saved.text.includes(fact.evidence)) archivedValues.add(fact.entity);
      }
      if (archivedValues.size !== corpus.facts.length)
        throw new Error(`Compaction archived ${archivedValues.size}/${corpus.facts.length} facts`);
      // No probe questions or expected-answer objects have entered any model context so far.
      const selected = selectCompactedQuestions(corpus, visible, seed, questionCount, scenario);
      const compactRow = {
        seed,
        route: isClassifierCheckpoint(checkpoint.details) ? "classifier" : "native-fallback",
        prefixFacts: compactState.prefixFacts,
        archivedFacts: archivedValues.size,
        hiddenFacts: selected.eligible,
        summaryBytes: Buffer.byteLength(compacted.summary),
        archiveCount: records.length,
        checkpointPath: join(dir, "checkpoint.json"),
      };
      compactions.push(compactRow);
      await save(compactRow.checkpointPath, {
        checkpoint,
        state: compactState,
        projection: manager.buildSessionProjection().messages,
      });
      await save(join(dir, "held-out-questions.json"), selected);
      console.error(JSON.stringify({ compaction: compactRow }));
      const arms = seedIndex % 2 ? [...ARMS].reverse() : [...ARMS];
      for (const arm of arms) {
        for (let start = 0; start < selected.probes.length; start += 8) {
          manager.branch(baseId);
          const probes = selected.probes.slice(start, start + 8);
          const first = probes[0];
          if (!first) throw new Error("Empty question batch");
          const entity = first.entity;
          if (!entity) throw new Error("Unknown sampled entity");
          probes.push(
            {
              id: "unknown_field",
              question: `What signing key was approved for service ${entity}?`,
              expected: null,
              category: "unknown",
              source: "unknown",
            },
            {
              id: "unknown_event",
              question: "Who won the Copenhagen chess tournament?",
              expected: null,
              category: "unknown",
              source: "unknown",
            },
          );
          const state = { ...operation(seed, "probe"), arm, batch: start / 8, probes };
          const session = await openSession(state, arm === "combined");
          const firstCall = calls.length;
          const timer = setTimeout(() => {
            state.failure = "Answering deadline";
            session.agent.abort();
          }, LIMITS.operationMs);
          const tracePath = join(dir, `${arm}-${state.batch}.json`);
          try {
            await session.prompt(promptFor(probes));
            await Promise.all(pending);
            const answer = session.getLastAssistantText() ?? "";
            const prefetch = session.messages.filter(
              (message) =>
                "customType" in message && message.customType === "context-masking-recall",
            );
            const prefetchText = messageEvidenceText(prefetch);
            const row: ProbeRow = {
              seed,
              arm,
              batch: state.batch,
              status: state.failure ? "failed" : "complete",
              ...(state.failure ? { failure: state.failure } : {}),
              score: scoreCompactedProbes(probes, answer),
              modelRequests: state.modelRequests,
              classifierRequests: state.classifierRequests,
              toolCalls: state.toolCalls,
              forcedFinal: state.forcedFinal,
              prefetchedFacts: probes.filter((probe) => probeEvidencePresent(prefetchText, probe))
                .length,
              prefetchFalsePositives: probes.filter(
                (probe) => probe.expected === null && prefetchText.includes(probe.question),
              ).length,
              tracePath,
            };
            rows.push(row);
            const messages = session.messages.map((message) =>
              "content" in message && Array.isArray(message.content)
                ? {
                    ...message,
                    content: message.content.filter((block) => block.type !== "thinking"),
                  }
                : message,
            );
            await save(tracePath, { row, answer, state, calls: calls.slice(firstCall), messages });
            await save(join(root, "partial.json"), { controls, compactions, rows, calls });
            console.error(
              JSON.stringify({
                seed,
                arm,
                batch: state.batch,
                correct: row.score.positiveCorrect,
                total: row.score.positiveTotal,
                unknownCorrect: row.score.unknownCorrect,
                toolCalls: row.toolCalls,
                prefetchedFacts: row.prefetchedFacts,
                status: row.status,
              }),
            );
            if (state.failure) throw new Error(state.failure);
          } finally {
            clearTimeout(timer);
            session.dispose();
          }
        }
      }
      for (const record of records) {
        const saved = await readTextArtifact(artifactRoot, record, 128 * 1024);
        if (saved.partial || digest(saved.text) !== archiveHashes.get(record.path))
          throw new Error("Evaluation changed archived evidence");
      }
    }
  } catch (error) {
    failure = String(error);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    runtime.streamSimple = stream;
    runtime.classify = classify;
  }
  const settingsUnchanged = digest(await readFile(liveSettingsPath, "utf8")) === liveSettingsHash;
  if (!settingsUnchanged) failure ??= "Live settings changed";
  const summaries = ARMS.map((arm) => {
    const completed = rows.filter((row) => row.arm === arm && row.status === "complete");
    const checks = completed.flatMap((row) => row.score.checks);
    const known = checks.filter((check) => check.expected !== null);
    const unknown = checks.filter((check) => check.expected === null);
    const passed =
      completed.length === Math.ceil(questionCount / 8) * seeds.length &&
      checks.every((check) => check.correct) &&
      completed.every((row) => row.score.valid);
    return {
      arm,
      completedBatches: completed.length,
      passed,
      correct: known.filter((check) => check.correct).length,
      total: known.length,
      unknownCorrect: unknown.filter((check) => check.correct).length,
      unknownTotal: unknown.length,
      staleAnswers: checks.filter((check) => check.stale).length,
      revisedQuestions: checks.filter((check) => check.revised).length,
      invalidAnswers: completed.filter((row) => !row.score.valid).length,
      toolCalls: completed.reduce((sum, row) => sum + row.toolCalls, 0),
      prefetchedFacts: completed.reduce((sum, row) => sum + row.prefetchedFacts, 0),
      prefetchFalsePositives: completed.reduce((sum, row) => sum + row.prefetchFalsePositives, 0),
      forcedFinalBatches: completed.filter((row) => row.forcedFinal).length,
      ...summarizeFactDimensions(checks),
    };
  });
  const report = {
    status: failure ? ("failed" as const) : ("complete" as const),
    ...(failure ? { failure } : {}),
    root,
    controls,
    settingsUnchanged,
    compactions,
    summaries,
    rows,
    calls,
    qualityPassed: failure === undefined && summaries.every((summary) => summary.passed),
    classifierFailures: calls.filter((call) => call.kind !== "answer" && call.error).length,
    limitations:
      "Sampled synthetic facts, not exhaustive hosted retrieval of all 1,000 facts. Manual compaction does not measure automatic trigger timing. SDK cost estimates are not subscription billing.",
  };
  await save(join(root, "report.json"), report);
  return report;
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      run: { type: "boolean", default: false },
      scenario: { type: "string", default: "receipt" },
      seeds: { type: "string" },
      questions: { type: "string" },
    },
  });
  const scenario = values.scenario;
  if (scenario !== "receipt" && scenario !== "diverse")
    throw new Error("Choose receipt or diverse scenario");
  const seeds = (
    values.seeds ??
    (scenario === "diverse"
      ? "diverse-scale-1,diverse-scale-2,diverse-scale-3,diverse-scale-4,diverse-scale-5"
      : "compacted-1,compacted-2,compacted-3")
  ).split(",");
  const questions = Number(values.questions ?? (scenario === "diverse" ? "100" : "24"));
  if (
    !seeds.length ||
    seeds.length > 5 ||
    new Set(seeds).size !== seeds.length ||
    seeds.some((seed) => !/^[a-zA-Z0-9_-]{1,60}$/u.test(seed))
  )
    throw new Error("Provide one to five distinct synthetic seed names");
  if (!Number.isInteger(questions) || questions < 8 || questions > 1_000)
    throw new Error("Questions must be an integer from 8 to 1000");
  const report = await runCompactedFacts(seeds, questions, values.run, scenario);
  console.log(
    JSON.stringify(
      report.status === "plan"
        ? report
        : {
            status: report.status,
            root: report.root,
            failure: report.failure,
            qualityPassed: report.qualityPassed,
            compactions: report.compactions,
            summaries: report.summaries,
            classifierFailures: report.classifierFailures,
          },
      null,
      2,
    ),
  );
  if (report.status !== "plan" && !report.qualityPassed) process.exitCode = 1;
}
