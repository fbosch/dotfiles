import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { BudgetAdviceInput, BudgetSnapshot } from "../extensions/subagents/budget";
import {
  buildPilotPrompt,
  type CheckedDeliverable,
  checkDeliverable,
  type FixtureLabel,
  labelReference,
  PILOT_FIXTURES,
} from "./subagent-budget-fixtures";
import type { BudgetTrialOptions, BudgetTrialResult, PilotArm } from "./subagent-budget-trial";

export interface PlanEntry {
  readonly block: number;
  readonly fixtureId: string;
  readonly arm: PilotArm;
}
export function buildPilotPlan(): readonly PlanEntry[] {
  return [0, 1].flatMap((block) =>
    PILOT_FIXTURES.flatMap((fixture) => {
      const primary: readonly PilotArm[] =
        block === 0 ? ["fixed", "advisory"] : ["advisory", "fixed"];
      const arms: readonly PilotArm[] = fixture.intendedLabel.endsWith("-blocked")
        ? primary
        : [...primary, "reference"];
      return arms.map((arm) => ({ block, fixtureId: fixture.id, arm }));
    }),
  );
}
export interface PilotSample extends PlanEntry {
  readonly checked: CheckedDeliverable;
  readonly checkpoint: CheckedDeliverable | null;
  readonly label: FixtureLabel | null;
  readonly outcome: BudgetTrialResult["outcome"];
  readonly waitingForParent: boolean;
  readonly turnsUsed: number;
  readonly workerDurationMs: number;
  readonly totalDurationMs: number;
  readonly timedOut: boolean;
  readonly referenceTurns: number;
  readonly cleanupConfirmed: boolean;
  readonly storageFailed: boolean;
  readonly workerSdkRequests: number;
  readonly workerObservedFetches: number;
  readonly classifierProviderDispatches: number;
  readonly classifierObservedFetches: number;
  readonly physicalModels: readonly string[];
  readonly classifierInputs: readonly BudgetAdviceInput[];
  readonly budget: BudgetSnapshot;
  readonly workerUsage: BudgetTrialResult["workerUsage"];
  readonly violations: readonly string[];
}
export function summarizeQuality(samples: readonly PilotSample[]) {
  const healthy = (sample: PilotSample) =>
    !sample.timedOut &&
    sample.cleanupConfirmed &&
    !sample.storageFailed &&
    sample.violations.length === 0 &&
    (sample.outcome === "completed" || sample.outcome === "budget-exhausted");
  const pairs = samples
    .filter((sample) => sample.arm === "advisory" && healthy(sample))
    .flatMap((advisory) => {
      const reference = samples.find(
        (sample) =>
          sample.arm === "reference" &&
          sample.referenceTurns > 0 &&
          healthy(sample) &&
          sample.fixtureId === advisory.fixtureId &&
          sample.block === advisory.block,
      );
      const input = advisory.classifierInputs.find((state) => state.turnsUsed === 2);
      const referenceInput = reference?.classifierInputs.find((state) => state.turnsUsed === 2);
      const probability = advisory.budget.decisions.find(
        (decision) => decision.turnsUsed === 2,
      )?.probability;
      if (
        input === undefined ||
        referenceInput === undefined ||
        JSON.stringify(input) !== JSON.stringify(referenceInput) ||
        probability === undefined ||
        (reference?.label !== "productive" && reference?.label !== "stalled")
      )
        return [];
      return [{ probability, useful: reference.label === "productive" }];
    });
  return {
    scoredPairs: pairs.length,
    productivePairs: pairs.filter((pair) => pair.useful).length,
    stalledPairs: pairs.filter((pair) => !pair.useful).length,
    brierScore: pairs.length
      ? pairs.reduce((sum, pair) => sum + (pair.probability - Number(pair.useful)) ** 2, 0) /
        pairs.length
      : null,
    threshold: null,
    calibration: "not-calibrated",
  };
}
function safeSample(
  entry: PlanEntry,
  result: BudgetTrialResult,
  totalDurationMs: number,
): PilotSample {
  const fixture = PILOT_FIXTURES.find((item) => item.id === entry.fixtureId);
  if (!fixture) throw new Error("Unknown planned fixture");
  const checked = checkDeliverable(fixture, result.visibleTexts);
  const checkpoint = result.checkpoint
    ? checkDeliverable(fixture, result.checkpoint.visibleTexts)
    : null;
  return {
    ...entry,
    checked,
    checkpoint,
    label:
      entry.arm === "reference" && result.referenceTurns > 0
        ? labelReference(
            fixture,
            checkpoint ?? undefined,
            checked,
            result.checkpoint?.budget.progress,
            result.waitingForParent,
          )
        : entry.arm === "reference"
          ? "unscorable"
          : null,
    outcome: result.outcome,
    turnsUsed: result.turnsUsed,
    waitingForParent: result.waitingForParent,
    workerDurationMs: result.durationMs,
    totalDurationMs,
    timedOut: result.timedOut,
    referenceTurns: result.referenceTurns,
    cleanupConfirmed: result.cleanupConfirmed,
    storageFailed: result.storageFailed,
    workerSdkRequests: result.workerSdkRequests,
    workerObservedFetches: result.workerObservedFetches,
    classifierProviderDispatches: result.classifierProviderDispatches,
    classifierObservedFetches: result.classifierObservedFetches,
    physicalModels: result.physicalModels,
    budget: result.budget,
    workerUsage: result.workerUsage,
    violations: result.violations,
    classifierInputs: result.adviceInputs.map((input) => ({
      taskKind: input.taskKind,
      initialTurns: input.initialTurns,
      grantedTurns: input.grantedTurns,
      hardMaxTurns: input.hardMaxTurns,
      turnsUsed: input.turnsUsed,
      automaticGrants: input.automaticGrants,
      progress: {
        completedTools: input.progress.completedTools,
        verifiedSuccesses: input.progress.verifiedSuccesses,
        failures: input.progress.failures,
        unknownOutcomes: input.progress.unknownOutcomes,
        consecutiveFailures: input.progress.consecutiveFailures,
      },
    })),
  };
}
async function executeTrial(options: BudgetTrialOptions, hardMs: number) {
  const started = performance.now();
  const processHandle = Bun.spawn(
    [process.execPath, join(import.meta.dir, "subagent-budget-trial-cli.ts")],
    {
      cwd: options.cwd,
      stdin: new Blob([JSON.stringify(options)]),
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    },
  );
  let hardStopped = false;
  let killFailed = false;
  const killGroup = () => {
    try {
      process.kill(-processHandle.pid, "SIGKILL");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) killFailed = true;
    }
  };
  const timer = setTimeout(() => {
    hardStopped = true;
    killGroup();
  }, hardMs);
  let exitCode: number;
  try {
    const [code, stdout, stderr] = await Promise.all([
      processHandle.exited,
      new Response(processHandle.stdout).text(),
      new Response(processHandle.stderr).text(),
    ]);
    exitCode = code;
    await Promise.all([
      writeFile(join(options.directory, "stdout.log"), stdout, { mode: 0o600, flag: "wx" }),
      writeFile(join(options.directory, "stderr.log"), stderr, { mode: 0o600, flag: "wx" }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  let groupSurvived = false;
  try {
    process.kill(-processHandle.pid, 0);
    groupSurvived = true;
    killGroup();
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) killFailed = true;
  }
  const elapsedMs = performance.now() - started;
  if (hardStopped || killFailed || groupSurvived || exitCode !== 0)
    return {
      ok: false as const,
      elapsedMs,
      exitCode,
      reason: hardStopped
        ? "hard-timeout"
        : killFailed
          ? "cleanup-unknown"
          : groupSurvived
            ? "process-group-survived"
            : "trial-failed",
    };
  // This private file is written only by our owned CLI; model text is confined to string fields.
  try {
    const result: BudgetTrialResult = JSON.parse(
      await readFile(join(options.directory, "result.json"), "utf8"),
    );
    return { ok: true as const, elapsedMs, result };
  } catch {
    return { ok: false as const, elapsedMs, exitCode, reason: "invalid-trial-result" };
  }
}
function optionsFromArgs(argv: readonly string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index],
      value = argv[index + 1];
    if (
      !key ||
      value === undefined ||
      values.has(key) ||
      !["--sdk-root", "--max-trials", "--deadline-ms"].includes(key)
    )
      throw new Error("Expected --sdk-root, optional --max-trials, and optional --deadline-ms");
    values.set(key, value);
  }
  const sdk = values.get("--sdk-root");
  const maxTrials = Number(values.get("--max-trials") ?? 26);
  const now = Date.now();
  const deadline = values.get("--deadline-ms")
    ? Number(values.get("--deadline-ms"))
    : now + 900_000;
  if (
    !sdk ||
    !Number.isSafeInteger(maxTrials) ||
    maxTrials < 1 ||
    maxTrials > 26 ||
    !Number.isSafeInteger(deadline) ||
    deadline <= now ||
    deadline > now + 900_000
  )
    throw new Error("Pilot limits must be 1-26 trials and at most 15 minutes");
  return { sdkRoot: resolve(sdk), maxTrials, deadline };
}
async function main() {
  const options = optionsFromArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  if (process.platform !== "darwin" && process.platform !== "linux")
    throw new Error("Pilot requires POSIX process groups");
  const directory = await mkdtemp(join(tmpdir(), "pi-subagent-budget-pilot-"));
  console.log(`PILOT_OUTPUT ${directory}`);
  const started = performance.now();
  const samples: PilotSample[] = [];
  const failures: {
    entry: PlanEntry;
    reason: string;
    elapsedMs: number;
    exitCode: number | null;
  }[] = [];
  const plan = buildPilotPlan().slice(0, options.maxTrials);
  let stopReason = "plan-complete";
  const sourcePaths = [
    "benchmarks/subagent-budget-fixtures.ts",
    "benchmarks/subagent-budget-trial.ts",
    "benchmarks/subagent-budget-trial-cli.ts",
    "benchmarks/subagent-budget-pilot.ts",
    "extensions/subagents/budget.ts",
    "extensions/subagents/budget-advisor.ts",
    "extensions/subagents/owner.ts",
    "extensions/subagents/driver.ts",
    "extensions/subagents/child-session.ts",
  ];
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(join(import.meta.dir, "..", path)))
          .digest("hex"),
      ]),
    ),
  );
  for (const [index, entry] of plan.entries()) {
    const remainingMs = Math.min(
      options.deadline - Date.now(),
      900_000 - (performance.now() - started),
    );
    if (remainingMs <= 8_000) {
      stopReason = "overall-deadline";
      break;
    }
    const fixture = PILOT_FIXTURES.find((item) => item.id === entry.fixtureId);
    if (!fixture) throw new Error("Unknown planned fixture");
    const trialDirectory = join(
      directory,
      `${String(index + 1).padStart(2, "0")}-${entry.fixtureId}-${entry.arm}`,
    );
    const cwd = join(trialDirectory, "work");
    await mkdir(cwd, { recursive: true, mode: 0o700 });
    for (const [path, content] of Object.entries(fixture.files)) {
      await mkdir(dirname(join(cwd, path)), { recursive: true, mode: 0o700 });
      await writeFile(join(cwd, path), content, { mode: 0o600, flag: "wx" });
    }
    const hardMs = Math.floor(Math.min(120_000, remainingMs) - 1_000);
    const trial = await executeTrial(
      {
        sdkRoot: options.sdkRoot,
        cwd,
        directory: trialDirectory,
        arm: entry.arm,
        prompt: buildPilotPrompt(fixture),
        timeoutMs: hardMs - 7_000,
      },
      hardMs,
    );
    if (!trial.ok) {
      failures.push({
        entry,
        reason: trial.reason,
        elapsedMs: trial.elapsedMs,
        exitCode: trial.exitCode,
      });
      stopReason = trial.reason;
      break;
    }
    const sample = safeSample(entry, trial.result, trial.elapsedMs);
    for (const [path, expected] of Object.entries(fixture.files)) {
      if ((await readFile(join(cwd, path), "utf8")) !== expected)
        throw new Error("Read-only fixture changed");
    }
    samples.push(sample);
    console.log(
      `PILOT_TRIAL ${JSON.stringify({
        ...entry,
        complete: sample.checked.complete,
        checkpoint: sample.checkpoint !== null,
        checks: sample.budget.checks,
        workerSdkRequests: sample.workerSdkRequests,
      })}`,
    );
    if (
      sample.outcome === "failed" ||
      sample.timedOut ||
      !sample.cleanupConfirmed ||
      sample.storageFailed ||
      sample.violations.length
    ) {
      stopReason = "trial-invariant-failure";
      break;
    }
    if (samples.length === 3 && samples.every((item) => item.checkpoint === null)) {
      stopReason = "no-checkpoint-in-first-case";
      break;
    }
  }
  const report = {
    version: 2,
    startedAt,
    deadline: options.deadline,
    elapsedMs: performance.now() - started,
    environment: {
      platform: process.platform,
      arch: process.arch,
      bun: Bun.version,
      sdk: "1.3.0",
      cachePolicy: "as-found; no paid warmups",
    },
    limits: {
      maxTrials: options.maxTrials,
      maximumTrialMs: 120_000,
      overallMs: 900_000,
      initialTurns: 4,
      fixtureCeiling: 8,
    },
    sourceHashes,
    stopReason,
    plannedTrials: plan.length,
    completedTrials: samples.length,
    failedTrials: failures.length + samples.filter((sample) => sample.outcome === "failed").length,
    measurementScope: {
      sdkRequests: "physical-model ModelRuntime.streamSimple invocations; not HTTP retry totals",
      observedFetches:
        "fetch calls observed through supplied transports; websocket/CLI coverage is unknown",
      providerAttempts:
        "classifier shared-requester telemetry; worker provider-attempt totals unavailable",
      reportedCost: "SDK-reported estimates, not billing receipts",
      clocks: "trial/suite monotonic performance.now; kernel decision durations Date.now",
    },
    quality: summarizeQuality(samples),
    samples,
    failures,
    productionAutomaticModeEnabled: false,
  };
  await writeFile(join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  console.log(`PILOT_REPORT ${join(directory, "report.json")}`);
  console.log(`PILOT_STOP ${stopReason}`);
  if (failures.length || stopReason === "trial-invariant-failure") process.exitCode = 1;
}
if (import.meta.main) await main();
