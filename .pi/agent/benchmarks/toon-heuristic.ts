import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { encode } from "@toon-format/toon";
import { containsLossyNumber, hasRecommendedToonCandidate } from "../extensions/toon/index";

const TOON_OPTIONS = {
  delimiter: "\t",
  keyFolding: "safe",
} as const;

export type ToonBenchmarkPath = "baseline" | "heuristic" | "reference";
export type TokenCounter = (text: string) => number;

export interface ToonBenchmarkFixture {
  readonly name: string;
  readonly value: unknown;
}

export type LossyNumberBenchmarkPath = "eager-scan" | "deferred-scan";

export interface LossyNumberBenchmarkFixture {
  readonly name: string;
  readonly jsonText: string;
}

export interface LossyNumberBenchmarkMeasurement {
  readonly fixture: string;
  readonly path: LossyNumberBenchmarkPath;
  readonly jsonChars: number;
  readonly p50Microseconds: number;
  readonly p95Microseconds: number;
  readonly p99Microseconds: number;
  readonly outcome: "candidate" | "lossy-reject" | "structural-reject";
}

export interface ToonBenchmarkOptions {
  readonly warmups?: number;
  readonly repetitions?: number;
  readonly tokenCounter?: TokenCounter;
}

export interface ToonBenchmarkMeasurement {
  readonly fixture: string;
  readonly path: ToonBenchmarkPath;
  readonly jsonChars: number;
  readonly p50Microseconds: number;
  readonly p95Microseconds: number;
  readonly p99Microseconds: number;
  readonly converted: boolean;
  readonly candidateCount?: number;
  readonly jsonTokens?: number;
  readonly toonTokens?: number;
  readonly tokenDelta?: number;
}

export interface ToonBenchmarkReport {
  readonly warmups: number;
  readonly repetitions: number;
  readonly measurements: readonly ToonBenchmarkMeasurement[];
  readonly lossyNumberMeasurements: readonly LossyNumberBenchmarkMeasurement[];
  readonly decisionMismatches: readonly {
    fixture: string;
    falsePositive: boolean;
    falseNegative: boolean;
  }[];
}

interface PathDecision {
  readonly converted: boolean;
  readonly candidateCount?: number;
  readonly jsonTokens?: number;
  readonly toonTokens?: number;
  readonly tokenDelta?: number;
}

const DEFAULT_WARMUPS = 100;
const DEFAULT_REPETITIONS = 1_000;

function makeUniformRows(rows: number): Record<string, unknown>[] {
  return Array.from({ length: rows }, (_, index) => ({
    active: index % 2 === 0,
    id: index + 1,
    name: `window-${index + 1}`,
    title: `Window ${index + 1}`,
  }));
}

function makeNestedUniformRows(rows: number): Record<string, unknown> {
  return {
    groups: Array.from({ length: Math.max(1, Math.ceil(rows / 5)) }, (_, group) => ({
      id: group + 1,
      windows: makeUniformRows(Math.min(5, rows - group * 5)),
    })),
  };
}

export function createToonBenchmarkFixtures(): readonly ToonBenchmarkFixture[] {
  return [
    {
      name: "hyprprop-singleton",
      value: {
        address: "0x59e0fcb06300",
        at: [3746, 506],
        class: "app.zen_browser.zen",
        floating: false,
        pid: 488348,
        size: [1128, 1428],
        title: "Pi - auth and integration health",
        workspace: { id: 2, name: "2" },
      },
    },
    {
      name: "primitive-arrays",
      value: {
        at: [3746, 506],
        size: [1128, 1428],
        tags: ["pip*", "pip-top-right", "pip-top-right*"],
      },
    },
    {
      name: "empty-arrays",
      value: { grouped: [], tags: [] },
    },
    {
      name: "mixed-array",
      value: { rows: [{ id: 1 }, "other", null] },
    },
    { name: "uniform-2", value: { windows: makeUniformRows(2) } },
    { name: "uniform-5", value: { windows: makeUniformRows(5) } },
    { name: "uniform-20", value: { windows: makeUniformRows(20) } },
    { name: "uniform-100", value: { windows: makeUniformRows(100) } },
    { name: "nested-uniform", value: makeNestedUniformRows(20) },
  ];
}

export function createLossyNumberBenchmarkFixtures(): readonly LossyNumberBenchmarkFixture[] {
  const structuralReject = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [`field-${index}`, index]),
  );
  const candidate = { windows: makeUniformRows(100) };

  return [
    { name: "structural-reject-safe", jsonText: stringify(structuralReject) },
    {
      name: "structural-reject-lossy",
      jsonText: stringify(structuralReject).replace('"field-99":99', '"field-99":9007199254740992'),
    },
    { name: "candidate-safe", jsonText: stringify(candidate) },
    {
      name: "candidate-lossy",
      jsonText: stringify(candidate).replace('"id":100', '"id":9007199254740992'),
    },
  ];
}

function stringify(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("Benchmark fixture is not JSON serializable");
  return text;
}

function runBaseline(jsonText: string): PathDecision {
  const value = JSON.parse(jsonText);
  const toon = encode(value, TOON_OPTIONS);
  return { converted: toon.length < jsonText.length };
}

function runHeuristic(jsonText: string): PathDecision {
  const value = JSON.parse(jsonText);
  if (hasRecommendedToonCandidate(value, jsonText.length) === false) {
    return { converted: false };
  }

  const toon = encode(value, TOON_OPTIONS);
  return { converted: toon.length < jsonText.length };
}

function runReference(jsonText: string, tokenCounter: TokenCounter): PathDecision {
  const value = JSON.parse(jsonText);
  const toon = encode(value, TOON_OPTIONS);
  const jsonTokens = tokenCounter(jsonText);
  const toonTokens = tokenCounter(toon);

  return {
    converted: toonTokens < jsonTokens,
    jsonTokens,
    toonTokens,
    tokenDelta: jsonTokens - toonTokens,
  };
}

function runPath(
  path: ToonBenchmarkPath,
  jsonText: string,
  tokenCounter: TokenCounter | undefined,
): PathDecision {
  if (path === "baseline") return runBaseline(jsonText);
  if (path === "heuristic") return runHeuristic(jsonText);
  if (tokenCounter === undefined) throw new Error("Reference path requires a token counter");
  return runReference(jsonText, tokenCounter);
}

function percentile(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

function runLossyNumberPath(
  path: LossyNumberBenchmarkPath,
  jsonText: string,
): LossyNumberBenchmarkMeasurement["outcome"] {
  if (path === "eager-scan" && containsLossyNumber(jsonText)) return "lossy-reject";

  const value: unknown = JSON.parse(jsonText);
  if (hasRecommendedToonCandidate(value, jsonText.length) === false) return "structural-reject";
  if (path === "deferred-scan" && containsLossyNumber(jsonText)) return "lossy-reject";
  return "candidate";
}

function benchmarkLossyNumberPath(
  fixture: LossyNumberBenchmarkFixture,
  path: LossyNumberBenchmarkPath,
  options: Required<Pick<ToonBenchmarkOptions, "warmups" | "repetitions">>,
): LossyNumberBenchmarkMeasurement {
  for (let index = 0; index < options.warmups; index += 1) {
    runLossyNumberPath(path, fixture.jsonText);
  }

  const samples: number[] = [];
  let outcome: LossyNumberBenchmarkMeasurement["outcome"] = "structural-reject";
  for (let index = 0; index < options.repetitions; index += 1) {
    const start = process.hrtime.bigint();
    outcome = runLossyNumberPath(path, fixture.jsonText);
    samples.push(Number(process.hrtime.bigint() - start));
  }

  return {
    fixture: fixture.name,
    path,
    jsonChars: fixture.jsonText.length,
    p50Microseconds: percentile(samples, 0.5) / 1_000,
    p95Microseconds: percentile(samples, 0.95) / 1_000,
    p99Microseconds: percentile(samples, 0.99) / 1_000,
    outcome,
  };
}

function benchmarkPath(
  fixture: ToonBenchmarkFixture,
  path: ToonBenchmarkPath,
  options: Required<Pick<ToonBenchmarkOptions, "warmups" | "repetitions">>,
  tokenCounter: TokenCounter | undefined,
): ToonBenchmarkMeasurement {
  const jsonText = stringify(fixture.value);

  for (let index = 0; index < options.warmups; index += 1) {
    runPath(path, jsonText, tokenCounter);
  }

  const samples: number[] = [];
  let decision: PathDecision = { converted: false };

  for (let index = 0; index < options.repetitions; index += 1) {
    const start = process.hrtime.bigint();
    decision = runPath(path, jsonText, tokenCounter);
    samples.push(Number(process.hrtime.bigint() - start));
  }

  return {
    fixture: fixture.name,
    path,
    jsonChars: jsonText.length,
    p50Microseconds: percentile(samples, 0.5) / 1_000,
    p95Microseconds: percentile(samples, 0.95) / 1_000,
    p99Microseconds: percentile(samples, 0.99) / 1_000,
    ...decision,
  };
}

function resolvedOptions(
  options: ToonBenchmarkOptions,
): Required<Pick<ToonBenchmarkOptions, "warmups" | "repetitions">> {
  return {
    warmups: options.warmups ?? DEFAULT_WARMUPS,
    repetitions: options.repetitions ?? DEFAULT_REPETITIONS,
  };
}

export function runToonBenchmarks(
  fixtures: readonly ToonBenchmarkFixture[] = createToonBenchmarkFixtures(),
  options: ToonBenchmarkOptions = {},
): ToonBenchmarkReport {
  const resolved = resolvedOptions(options);
  const paths: ToonBenchmarkPath[] = options.tokenCounter
    ? ["baseline", "heuristic", "reference"]
    : ["baseline", "heuristic"];
  const measurements: ToonBenchmarkMeasurement[] = [];

  for (const fixture of fixtures) {
    for (const path of paths) {
      measurements.push(benchmarkPath(fixture, path, resolved, options.tokenCounter));
    }
  }

  const lossyNumberMeasurements: LossyNumberBenchmarkMeasurement[] = [];
  for (const fixture of createLossyNumberBenchmarkFixtures()) {
    for (const path of ["eager-scan", "deferred-scan"] as const) {
      lossyNumberMeasurements.push(benchmarkLossyNumberPath(fixture, path, resolved));
    }
  }

  const decisionMismatches = options.tokenCounter
    ? fixtures.map((fixture) => {
        const heuristic = measurements.find(
          (measurement) => measurement.fixture === fixture.name && measurement.path === "heuristic",
        );
        const reference = measurements.find(
          (measurement) => measurement.fixture === fixture.name && measurement.path === "reference",
        );
        return {
          fixture: fixture.name,
          falsePositive: heuristic?.converted === true && reference?.converted !== true,
          falseNegative: heuristic?.converted !== true && reference?.converted === true,
        };
      })
    : [];

  return {
    warmups: resolved.warmups,
    repetitions: resolved.repetitions,
    measurements,
    lossyNumberMeasurements,
    decisionMismatches,
  };
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function isTokenCounterModule(value: unknown): value is { countTokens: TokenCounter } {
  return (
    typeof value === "object" &&
    value !== null &&
    "countTokens" in value &&
    typeof value.countTokens === "function"
  );
}

async function loadTokenCounter(): Promise<TokenCounter | undefined> {
  const modulePath = process.env.PI_TOON_TOKEN_COUNTER_MODULE;
  if (modulePath === undefined) return undefined;

  const loaded: unknown = await import(pathToFileURL(resolve(modulePath)).href);
  if (isTokenCounterModule(loaded) === false) {
    throw new Error(`Token counter module must export countTokens(text): ${modulePath}`);
  }
  return loaded.countTokens;
}

export async function main(): Promise<void> {
  const tokenCounter = await loadTokenCounter();
  const report = runToonBenchmarks(undefined, {
    warmups: positiveInteger(process.env.PI_TOON_BENCHMARK_WARMUPS, DEFAULT_WARMUPS),
    repetitions: positiveInteger(process.env.PI_TOON_BENCHMARK_RUNS, DEFAULT_REPETITIONS),
    tokenCounter,
  });

  if (tokenCounter === undefined) {
    console.error(
      "Reference path skipped. Set PI_TOON_TOKEN_COUNTER_MODULE to a module exporting countTokens(text).",
    );
  }
  console.log(JSON.stringify(report, undefined, 2));
}

if (import.meta.main) await main();
