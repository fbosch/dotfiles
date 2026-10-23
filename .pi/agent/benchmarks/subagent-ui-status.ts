import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { TuiAltScreen, stripTerminalSequences, type Component, type Terminal } from "@earendil-works/pi-tui";
import { theme } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme";
import { processCleanupHealth } from "../extensions/minimal-subagents/health";
import { HISTORY_ENTRY, type SavedWorker } from "../extensions/minimal-subagents/history";
import { registerSubagentHost, type HostDependencies } from "../extensions/minimal-subagents/host";
import type { ChildDriver, ChildExecutionOutcome, WorkerSnapshot } from "../extensions/minimal-subagents/owner";
import type { ParentRuntime } from "../extensions/minimal-subagents/parent-runtime";
import type { ResolvedSpecialist } from "../extensions/minimal-subagents/specialist";
import type { WorkerRenderState } from "../extensions/minimal-subagents/interaction";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "../../..");
const baselinePath = "openspec/changes/pi-minimal-subagents/references/ui-status-baseline-2026-10-23.json";
const sourcePaths = [
  ".pi/agent/extensions/minimal-subagents/owner.ts",
  ".pi/agent/extensions/minimal-subagents/host.ts",
  ".pi/agent/extensions/minimal-subagents/ui.ts",
  ".pi/agent/extensions/minimal-subagents/widget.ts",
  ".pi/agent/extensions/minimal-subagents/presentation.ts",
  ".pi/agent/extensions/minimal-subagents/tools.ts",
  ".pi/agent/extensions/minimal-subagents/launch-cards.ts",
  ".pi/agent/extensions/minimal-subagents/rendering.ts",
  ".pi/agent/extensions/minimal-subagents/delivery.ts",
  ".pi/agent/extensions/minimal-subagents/interaction.ts",
  ".pi/agent/extensions/minimal-subagents/specialist.ts",
  ".pi/agent/extensions/minimal-subagents/child-session.ts",
];
const assignmentCounts = { small: 1, heavy: 3 } as const;
const transcriptSizes = { small: 20, heavy: 100 } as const;
const workerCounts = { small: 5, heavy: 40 } as const;
const runningWorkers = 4;
const measuredBatches = 7;
const warmupBatches = 1;
const framesPerBatch = 20;
const instabilityMadFraction = 0.25;

interface Cohort {
  readonly name: "small" | "heavy";
  readonly runtime: ParentRuntime;
  readonly cardRenders: readonly (() => string[])[];
  readonly widget: Component & { dispose(): void };
  readonly widgetNames: readonly string[];
}

interface BatchSample {
  readonly batch: number;
  readonly elapsedMs: number;
  readonly msPerFrame: number;
  readonly checksum: number;
}

function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function git(command: string[]): string {
  return execFileSync("git", command, { cwd: repoRoot, encoding: "utf8" }).trimEnd();
}

async function sdkVersion(): Promise<string> {
  let directory = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
  for (let depth = 0; depth < 8; depth++) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as { name?: string; version?: string };
      if (manifest.name === "@earendil-works/pi-coding-agent" && manifest.version) return manifest.version;
    } catch { /* Continue to the package root. */ }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("Could not identify the installed Pi SDK version");
}

function fixtureConfig(): ResolvedSpecialist {
  return {
    name: "ui-status-benchmark",
    description: "Synthetic benchmark worker",
    prompt: "Synthetic fixture only",
    model: "fixture/model",
    maxTurns: 10,
    tools: [],
    excludeTools: [],
    extensions: [],
    skills: [],
  };
}

function transcript(size: number, workerId: string, assignmentId: string) {
  const roles = ["system", "user", "assistant", "tool"] as const;
  return Array.from({ length: size }, (_, index) => ({
    role: roles[index % roles.length]!,
    text: `synthetic ${workerId}/${assignmentId} entry ${index}`,
    timestamp: index,
  }));
}

function historicalWorker(parentSessionId: string, id: string, assignmentCount: number, entriesPerAssignment: number, index: number): SavedWorker {
  const assignments = Array.from({ length: assignmentCount }, (_, assignmentIndex) => {
    const assignmentId = `${id}-assignment-${assignmentIndex + 1}`;
    return {
      id: assignmentId,
      prompt: `Historical assignment ${assignmentIndex + 1}`,
      outcome: "completed" as const,
      maxTurns: 10,
      turnsUsed: 1,
      remainingTurns: 9,
      report: `Synthetic historical report ${assignmentIndex + 1}`,
      persistence: "saved" as const,
      transcript: transcript(entriesPerAssignment, id, assignmentId),
    };
  });
  const worker: WorkerSnapshot = {
    parentSessionId,
    id,
    specialist: `historical-${index}`,
    config: fixtureConfig(),
    status: "idle",
    liveSession: "available",
    currentAssignmentId: assignments.at(-1)!.id,
    assignments,
    createdAt: index,
  };
  return { version: 1, worker };
}

function terminal(): Terminal {
  return {
    columns: 100,
    rows: 40,
    kittyProtocolActive: false,
    start() {},
    stop() {},
    async drainInput() {},
    write() {},
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
  };
}

function visibleLines(component: Component): string[] {
  return component.render(100).map(stripTerminalSequences);
}

function consume(lines: readonly string[], checksum: number): number {
  let next = (checksum + lines.length * 31) >>> 0;
  for (const line of lines) {
    next = (next * 33 + line.length) >>> 0;
    if (line.length > 0) next = (next * 33 + line.charCodeAt(0) + line.charCodeAt(line.length - 1)) >>> 0;
  }
  return next;
}

async function makeCohort(name: "small" | "heavy"): Promise<Cohort> {
  const parentSessionId = `benchmark-parent-${name}`;
  const assignmentCount = assignmentCounts[name];
  const entriesPerAssignment = transcriptSizes[name];
  const workerCount = workerCounts[name];
  const historicalCount = workerCount - runningWorkers;
  const sessionEntries: unknown[] = Array.from({ length: historicalCount }, (_, index) => ({
    type: "custom",
    customType: HISTORY_ENTRY,
    data: historicalWorker(parentSessionId, `${name}-historical-${index}`, assignmentCount, entriesPerAssignment, index),
  }));
  const attempts = new Map<string, number>();
  const held = new Set<string>();
  let resolveHeld: (() => void) | undefined;
  const allHeld = new Promise<void>((resolvePromise) => { resolveHeld = resolvePromise; });
  const driver: ChildDriver & { observation(workerId: string): undefined } = {
    start(input, callbacks) { return run(input, callbacks); },
    prompt(input, callbacks) { return run(input, callbacks); },
    async steer() {},
    async abort(workerId) {
      if (held.has(workerId)) {
        held.delete(workerId);
        attempts.set(workerId, assignmentCount + 1);
        pending.get(workerId)?.({ kind: "failed", turnsUsed: 1, error: "Synthetic teardown" });
      }
    },
    async close() { return { confirmed: true }; },
    observation() { return undefined; },
  };
  const pending = new Map<string, (outcome: ChildExecutionOutcome) => void>();
  function run(input: { workerId: string; assignmentId: string }, callbacks: Parameters<ChildDriver["start"]>[1]): Promise<ChildExecutionOutcome> {
    const attempt = (attempts.get(input.workerId) ?? 0) + 1;
    attempts.set(input.workerId, attempt);
    for (const entry of transcript(entriesPerAssignment, input.workerId, input.assignmentId)) {
      callbacks.onTranscript({ role: entry.role, text: entry.text, timestamp: entry.timestamp });
    }
    callbacks.onTurn(1);
    if (attempt === assignmentCount) {
      held.add(input.workerId);
      if (held.size === runningWorkers) resolveHeld?.();
      return new Promise((resolvePromise) => { pending.set(input.workerId, resolvePromise); });
    }
    return Promise.resolve({ kind: "completed", turnsUsed: 1, report: `Synthetic report ${attempt}` });
  }

  let widgetFactory: ((tui: TuiAltScreen, theme: Theme) => Component & { dispose(): void }) | undefined;
  const sessionManager = {
    getSessionId: () => parentSessionId,
    getEntries: () => sessionEntries,
    getSessionFile: () => scriptPath,
    buildSessionProjection: () => ({ messages: [] as readonly unknown[] }),
  };
  const context = {
    cwd: repoRoot,
    mode: "tui",
    hasUI: true,
    sessionManager,
    modelRegistry: { getAvailable: () => [] },
    isProjectTrusted: () => false,
    ui: {
      setWidget(_name: string, factory: ((tui: TuiAltScreen, theme: Theme) => Component & { dispose(): void }) | undefined) {
        if (factory) widgetFactory = factory;
      },
      notify() {},
    },
  } as unknown as ExtensionContext;
  const registered = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
  const hooks = new Map<string, (event: unknown, context: ExtensionContext) => unknown>();
  const pi = {
    registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) { registered.set(tool.name, tool); },
    registerMessageRenderer() {},
    registerCommand() {},
    on(event: string, handler: (event: unknown, context: ExtensionContext) => unknown) { hooks.set(event, handler); },
    appendEntry(customType: string, data: unknown) { sessionEntries.push({ type: "custom", customType, data }); },
    sendMessage() {},
  } as unknown as ExtensionAPI;
  let runtime: ParentRuntime | undefined;
  const dependencies: HostDependencies = {
    createDriver: () => driver,
    resolve: async () => fixtureConfig(),
    health: processCleanupHealth({}),
    runtimeChanged(value) { if (value) runtime = value; },
  };
  registerSubagentHost(pi, { agentDir: join(repoRoot, ".pi", "agent"), widgetRows: 8 }, dependencies);
  const tui = new TuiAltScreen(terminal(), false);
  const config = fixtureConfig();
  const activeIds: string[] = [];
  const cardRenders: Array<() => string[]> = [];
  const launchTool = registered.get("subagent");
  if (!launchTool?.renderResult) throw new Error("Registered subagent tool has no host result renderer");

  const sessionStart = hooks.get("session_start");
  if (!sessionStart) throw new Error("registerSubagentHost did not register session_start");
  await sessionStart({ reason: "benchmark" }, context);
  function getRuntimeFromHost(): ParentRuntime {
    if (!runtime) throw new Error("registerSubagentHost did not expose its runtime");
    return runtime;
  }

  const hostRuntime = getRuntimeFromHost();
  for (let index = 0; index < runningWorkers; index++) {
    const launch = await hostRuntime.launch({ specialist: config.name, prompt: `Running assignment ${index + 1}` });
    const workerId = launch.workerId;
    activeIds.push(workerId);
    let currentAssignmentId = launch.assignmentId;
    for (let assignmentIndex = 1; assignmentIndex < assignmentCount; assignmentIndex++) {
      await hostRuntime.delivery.owner.wait(workerId, currentAssignmentId);
      const next = await hostRuntime.control({ action: "continue", workerId, prompt: `Continuation ${assignmentIndex + 1}` });
      currentAssignmentId = next.assignmentId;
    }
    const staleReceipt = {
      ...launch,
      worker: {
        ...launch.worker,
        state: "queued",
        assignments: launch.worker.assignments.map((assignment) => ({ ...assignment, outcome: "queued" })),
      },
    };
    const result = { content: [{ type: "text", text: JSON.stringify(staleReceipt) }], isError: false };
    const state: WorkerRenderState = {};
    const renderContext = { state, toolCallId: `benchmark-card-${index}`, invalidate() {}, isError: false };
    cardRenders.push(() => {
      const component = launchTool.renderResult!(result, { expanded: false, isPartial: false }, theme, renderContext);
      return visibleLines(component);
    });
  }
  await allHeld;

  const owner = hostRuntime.delivery.owner;
  const snapshots = owner.list();
  if (snapshots.length !== workerCount) throw new Error(`${name}: expected ${workerCount} workers, got ${snapshots.length}`);
  const activeSet = new Set(activeIds);
  for (const worker of snapshots) {
    const active = activeSet.has(worker.id);
    if (active ? worker.status !== "running" : worker.status !== "historical") {
      throw new Error(`${name}: worker ${worker.id} has unexpected ${worker.status} status`);
    }
    if (worker.assignments.length !== assignmentCount) {
      throw new Error(`${name}: worker ${worker.id} has ${worker.assignments.length} assignments, expected ${assignmentCount}`);
    }
    for (const assignment of worker.assignments) {
      if (assignment.transcript.length !== entriesPerAssignment) {
        throw new Error(`${name}: ${worker.id}/${assignment.id} has ${assignment.transcript.length} entries, expected ${entriesPerAssignment}`);
      }
    }
  }
  if (activeIds.length !== runningWorkers) throw new Error(`${name}: expected ${runningWorkers} active workers`);
  if (!widgetFactory) throw new Error(`${name}: host did not register a TUI widget factory`);
  const widget = widgetFactory(tui, theme);
  const widgetNames = activeIds.map((id) => owner.inspect(id).specialist);
  const cohort: Cohort = {
    name,
    runtime: hostRuntime,
    cardRenders,
    widget,
    widgetNames,
  };
  const preflight = renderFrame(cohort, true);
  if (!Number.isSafeInteger(preflight) || preflight < 0) throw new Error(`${name}: invalid preflight checksum`);
  return cohort;
}

function renderFrame(cohort: Cohort, validate: boolean): number {
  let checksum = 0;
  for (const renderCard of cohort.cardRenders) {
    const lines = renderCard();
    if (lines.length === 0) throw new Error(`${cohort.name}: registered card renderer returned no output`);
    if (validate && !lines.join("\n").includes("running")) {
      throw new Error(`${cohort.name}: registered card renderer did not project the live running status`);
    }
    checksum = consume(lines, checksum);
  }
  const widgetLines = visibleLines(cohort.widget);
  if (widgetLines.length === 0) throw new Error(`${cohort.name}: registered widget renderer returned no output`);
  if (validate) {
    const rendered = widgetLines.join("\n");
    for (const name of cohort.widgetNames) {
      if (!rendered.includes(name)) throw new Error(`${cohort.name}: widget output omitted active worker ${name}`);
    }
  }
  return consume(widgetLines, checksum);
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1]! + ordered[middle]!) / 2 : ordered[middle]!;
}

function summarize(samples: readonly BatchSample[]) {
  const values = samples.map((sample) => sample.msPerFrame);
  const center = median(values);
  const mad = median(values.map((value) => Math.abs(value - center)));
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return {
    samples,
    medianMsPerFrame: center,
    minMsPerFrame: minimum,
    maxMsPerFrame: maximum,
    medianAbsoluteDeviationMsPerFrame: mad,
    madFractionOfMedian: center === 0 ? null : mad / center,
    stability: center === 0 || mad / center > instabilityMadFraction ? "unstable" : "within-budget",
  };
}

function measureBatch(cohort: Cohort, batch: number): BatchSample {
  let checksum = 0;
  const start = performance.now();
  for (let frame = 0; frame < framesPerBatch; frame++) checksum = (checksum + renderFrame(cohort, false)) >>> 0;
  const elapsedMs = performance.now() - start;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || !Number.isSafeInteger(checksum)) {
    throw new Error(`${cohort.name}: invalid timing or checksum in batch ${batch}`);
  }
  return { batch, elapsedMs, msPerFrame: elapsedMs / framesPerBatch, checksum };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let phase: "baseline" | "candidate" = "baseline";
  let output: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--phase") {
      const value = args[++index];
      if (value !== "baseline" && value !== "candidate") throw new Error("--phase must be baseline or candidate");
      phase = value;
    } else if (arg === "--output") {
      output = args[++index];
      if (!output) throw new Error("--output requires a file path");
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (phase === "candidate" && !output) throw new Error("Candidate runs require a separate --output path");
  const outputPath = resolve(repoRoot, output ?? baselinePath);
  if (await Bun.file(outputPath).exists()) throw new Error(`Refusing to overwrite existing artifact: ${relative(repoRoot, outputPath)}`);

  initTheme("dark", false);
  const cohorts = [await makeCohort("small"), await makeCohort("heavy")];
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let fakeTimerId = 0;
  // Active-row animation is outside this render-cost target; suppress timer callbacks for repeatable frames.
  globalThis.setInterval = (() => ++fakeTimerId as unknown as ReturnType<typeof setInterval>) as typeof globalThis.setInterval;
  globalThis.clearInterval = (() => {}) as typeof globalThis.clearInterval;
  const warmup: Record<string, BatchSample> = {};
  const samples: Record<string, BatchSample[]> = { small: [], heavy: [] };
  try {
    for (const cohort of cohorts) warmup[cohort.name] = measureBatch(cohort, 0);
    for (let batch = 1; batch <= measuredBatches; batch++) {
      const order = batch % 2 === 1 ? cohorts : [...cohorts].reverse();
      for (const cohort of order) samples[cohort.name]!.push(measureBatch(cohort, batch));
    }
  } finally {
    for (const cohort of cohorts) cohort.widget.dispose();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
  for (const cohort of cohorts) await cohort.runtime.shutdown();

  const sdk = await sdkVersion();
  const workingTree = git(["status", "--short", "--untracked-files=normal"]);
  const revision = git(["rev-parse", "HEAD"]);
  const sourceHashes: Record<string, string> = {};
  for (const path of sourcePaths) sourceHashes[path] = sha256(await readFile(join(repoRoot, path)));
  const harnessHash = sha256(await readFile(scriptPath));
  const results = Object.fromEntries(cohorts.map((cohort) => [cohort.name, summarize(samples[cohort.name]!)]));
  const unstable = Object.values(results).some((result) => result.stability === "unstable");
  const artifact = {
    schemaVersion: 1,
    benchmark: "minimal-subagents-ui-status",
    phase,
    capturedAt: new Date().toISOString(),
    command: `bun run .pi/agent/benchmarks/subagent-ui-status.ts --phase ${phase} --output ${relative(repoRoot, outputPath)}`,
    identity: {
      revision,
      workingTreeDirty: workingTree.length > 0,
      workingTreeStatus: workingTree,
      sourceSha256: sourceHashes,
      harnessSha256: harnessHash,
    },
    environment: {
      platform: process.platform,
      architecture: process.arch,
      operatingSystemRelease: (await import("node:os")).release(),
      cpuModel: cpus()[0]?.model ?? "unavailable",
      cpuCount: cpus().length,
      bun: Bun.version,
      nodeCompatibilityVersion: process.version,
      piCodingAgentSdk: sdk,
    },
    method: {
      metric: "monotonic wall-clock milliseconds per frame",
      framesPerBatch,
      warmupBatches,
      measuredBatches,
      interleaving: "alternate small/heavy batch order across the seven measured rounds",
      setupTimed: false,
      animationTimers: "suppressed; active-row timer callbacks are outside the render-cost target",
      instabilityRule: `unstable if median absolute deviation / median exceeds ${instabilityMadFraction}`,
    },
    workload: {
      small: { workers: workerCounts.small, assignmentsPerWorker: assignmentCounts.small, transcriptEntriesPerAssignment: transcriptSizes.small },
      heavy: { workers: workerCounts.heavy, assignmentsPerWorker: assignmentCounts.heavy, transcriptEntriesPerAssignment: transcriptSizes.heavy },
      runningCardLookupsPerFrame: runningWorkers,
      widgetRendersPerFrame: 1,
      remainingWorkerState: "historical",
      providerOrNetworkWork: false,
      transcriptEntryText: "short deterministic synthetic role/text/timestamp records",
    },
    correctness: {
      checks: [
        "owner contains the predetermined worker and assignment counts",
        "four current workers are running and all others are historical",
        "every assignment has the predetermined transcript-entry count",
        "registered host card renderers project live running status over a stale queued receipt",
        "registered host widget renderer includes each running worker",
        "each timed frame returns non-empty registered card and widget output and consumes a checksum",
      ],
      passed: true,
    },
    acceptanceCriterion: {
      heavyMedianReduction: "at least 20% and at least 0.5 ms/frame",
      smallCaseRegression: "no more than 0.1 ms/frame",
      correctness: "unchanged",
    },
    warmup,
    results,
    verdict: unstable ? "baseline captured; sampling stability guard exceeded" : "baseline captured; candidate not run",
  };
  await Bun.write(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({
    artifact: relative(repoRoot, outputPath),
    revision,
    harnessSha256: harnessHash,
    results: Object.fromEntries(Object.entries(results).map(([name, value]) => [name, {
      medianMsPerFrame: value.medianMsPerFrame,
      rangeMsPerFrame: [value.minMsPerFrame, value.maxMsPerFrame],
      madFractionOfMedian: value.madFractionOfMedian,
      stability: value.stability,
      rawMsPerFrame: value.samples.map((sample) => sample.msPerFrame),
    }])),
    verdict: artifact.verdict,
  }, null, 2));
}

await main();
