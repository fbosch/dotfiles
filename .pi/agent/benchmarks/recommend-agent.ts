import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { discoverAgentDefinitions } from "../extensions/recommend-agent/discovery";
import {
  type RecommendationEvaluation,
  recommendAgent,
} from "../extensions/recommend-agent/recommendation";
import { DEFAULT_RECOMMEND_AGENT_CONFIG } from "../extensions/recommend-agent/settings";
import type { VercelGatewayFetch } from "../lib/vercel-gateway";
import {
  RECOMMEND_AGENT_BENCHMARK_CASES,
  RECOMMEND_AGENT_BENCHMARK_CATALOG,
  type RecommendationBenchmarkCase,
} from "./recommend-agent-fixtures";
import { type BenchmarkPrediction, calculateBenchmarkMetrics } from "./skill-selection-metrics";
import {
  DEFAULT_HOSTED_MAX_ATTEMPTS,
  DEFAULT_HOSTED_MAX_CASE_WAIT_MS,
  DEFAULT_HOSTED_MAX_RUN_WAIT_MS,
  DEFAULT_HOSTED_RETRY_BASE_MS,
  DEFAULT_HOSTED_RETRY_CAP_MS,
  runWithHostedRetries,
} from "./skill-selection-retries";

const DEFAULT_TIMEOUT_MS = 1200;
const DEFAULT_HOSTED_LIMIT = 1;
const MAX_CASES = RECOMMEND_AGENT_BENCHMARK_CASES.length;

type RunMode = "mock-jev" | "jev" | "primary";

interface CliOptions {
  readonly mode: RunMode;
  readonly limit: number;
  readonly all: boolean;
  readonly output?: string;
  readonly authProfile: string;
  readonly primaryModel?: string;
}

function metricsCases(cases: readonly RecommendationBenchmarkCase[]) {
  return cases.map(({ name, task, relevant, explicitSkillInvocation }) => ({
    name,
    request: task,
    relevant,
    ...(explicitSkillInvocation === undefined ? {} : { explicitSkillInvocation }),
  }));
}

function preferenceMetrics(
  cases: readonly RecommendationBenchmarkCase[],
  predictions: readonly (BenchmarkPrediction | undefined)[],
): Record<string, { cases: number; correct: number; accuracy: number | null }> {
  const result = {
    stay: { cases: 0, correct: 0, accuracy: null as number | null },
    abstain: { cases: 0, correct: 0, accuracy: null as number | null },
  };
  for (const [index, testCase] of cases.entries()) {
    const expected = testCase.relevant[0];
    if (expected !== "stay" && expected !== "abstain") continue;
    const bucket = result[expected];
    bucket.cases += 1;
    if (
      predictions[index]?.unavailable !== true &&
      predictions[index]?.names.length === 1 &&
      predictions[index]?.names[0] === expected
    ) {
      bucket.correct += 1;
    }
  }
  result.stay.accuracy = result.stay.cases === 0 ? null : result.stay.correct / result.stay.cases;
  result.abstain.accuracy =
    result.abstain.cases === 0 ? null : result.abstain.correct / result.abstain.cases;
  return result;
}

function predictionFromEvaluation(
  evaluation: RecommendationEvaluation,
  elapsedMs: number,
): BenchmarkPrediction {
  if (evaluation.decision.decision === "recommend") {
    return { names: [evaluation.decision.agentId], latencyMs: elapsedMs };
  }
  if (evaluation.decision.decision === "stay") return { names: ["stay"], latencyMs: elapsedMs };
  if (evaluation.decision.reason === "gateway-failure") {
    return {
      names: [],
      latencyMs: elapsedMs,
      unavailable: true,
      failure: {
        stage: "request",
        reason: evaluation.gatewayFailure ?? "gateway-failure",
      },
    };
  }
  if (evaluation.decision.reason === "invalid-evaluation-response") {
    return {
      names: [],
      latencyMs: elapsedMs,
      unavailable: true,
      failure: { stage: "evaluation", reason: "invalid-evaluation-response" },
    };
  }
  if (
    evaluation.decision.reason === "disabled" ||
    evaluation.decision.reason === "explicit-routing"
  ) {
    return { names: [], latencyMs: elapsedMs };
  }
  return { names: ["abstain"], latencyMs: elapsedMs };
}

function materializeCatalog(root: string, denied: readonly string[] = []): void {
  const agents = join(root, "agents");
  mkdirSync(agents, { recursive: true });
  const deniedSet = new Set(denied);
  for (const definition of RECOMMEND_AGENT_BENCHMARK_CATALOG) {
    const enabled = !deniedSet.has(definition.id);
    writeFileSync(
      join(agents, `${definition.id}.md`),
      `---\ndescription: ${definition.description}\nenabled: ${enabled}\n---\nSynthetic benchmark body is not sent to the evaluator.`,
    );
  }
}

function mockChoice(task: string, intent: string, available: readonly string[]): string {
  const text = `${task} ${intent}`.toLowerCase();
  if (text.includes("make this better") || text.includes("several different tasks"))
    return "abstain";
  if (text.includes("small mechanical edit")) return "stay";
  const preferred = text.includes("configuration moves")
    ? "analyze"
    : text.includes("locate the modules")
      ? "explore"
      : text.includes("satisfies the stated invariants")
        ? "validate"
        : text.includes("regression coverage")
          ? "test"
          : text.includes("review this patch")
            ? "review"
            : text.includes("diagnose why") ||
                text.includes("failing runtime") ||
                text.includes("failing runtime behavior")
              ? "debug"
              : text.includes("exact option name")
                ? "lookup"
                : text.includes("documented approaches")
                  ? "research"
                  : "abstain";
  return available.includes(preferred) ? preferred : "abstain";
}

function mockFetch(): VercelGatewayFetch {
  return async (_input, init) => {
    let body: { state: { task: string; intent: string; agents: readonly { id: string }[] } };
    try {
      body = JSON.parse(String(init?.body)) as {
        state: { task: string; intent: string; agents: readonly { id: string }[] };
      };
    } catch {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    const choice = mockChoice(
      body.state.task,
      body.state.intent,
      body.state.agents.map(({ id }) => id),
    );
    const choices = [...body.state.agents.map(({ id }) => id), "stay", "abstain"];
    const confidence = 0.92;
    const probabilities = Object.fromEntries(
      choices.map((candidate) => [
        candidate,
        candidate === choice ? confidence : (1 - confidence) / (choices.length - 1),
      ]),
    );
    return new Response(
      JSON.stringify({ answers: { route: { type: "choice", choice, confidence, probabilities } } }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };
}

async function createGatewayRegistry(profile: string): Promise<ModelRegistry> {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const authPath =
    profile === "default"
      ? join(agentDir, "auth.json")
      : join(agentDir, "auth-profiles", `${profile}.json`);
  const runtime = await ModelRuntime.create({
    authPath,
    modelsPath: join(agentDir, "models.json"),
    refreshOnCreate: false,
  });
  return new ModelRegistry(runtime);
}

function lexicalPrediction(testCase: RecommendationBenchmarkCase): BenchmarkPrediction {
  if (testCase.explicitSkillInvocation === true) return { names: [] };
  const denied = new Set(testCase.denied ?? []);
  if (testCase.relevant[0] === "stay") return { names: ["stay"] };
  if (testCase.relevant[0] === "abstain") return { names: ["abstain"] };
  const words = new Set(
    `${testCase.task} ${testCase.intent}`
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((word) => word.length > 3),
  );
  const candidates = RECOMMEND_AGENT_BENCHMARK_CATALOG.filter(({ id }) => !denied.has(id));
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: [...new Set(candidate.description.toLowerCase().split(/[^a-z0-9]+/u))].filter((word) =>
        words.has(word),
      ).length,
    }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score === 0 || (second && best.score === second.score))
    return { names: ["abstain"] };
  return { names: [best.candidate.id] };
}

async function runMockJev(
  cases: readonly RecommendationBenchmarkCase[],
): Promise<BenchmarkPrediction[]> {
  const predictions: BenchmarkPrediction[] = [];
  const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "recommend-agent-benchmark-"));
  try {
    for (const testCase of cases) {
      materializeCatalog(root, testCase.denied);
      const started = performance.now();
      const evaluation = await recommendAgent(
        {
          task: testCase.task,
          intent: testCase.intent,
          ...(testCase.context === undefined ? {} : { context: testCase.context }),
        },
        {
          modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: "offline" } }) },
          config: {
            ...DEFAULT_RECOMMEND_AGENT_CONFIG,
            enabled: true,
            timeoutMs: DEFAULT_TIMEOUT_MS,
          },
          discovery: { cwd: root, projectTrusted: false, agentDir: root },
          fetch: mockFetch(),
        },
      );
      predictions.push(
        predictionFromEvaluation(evaluation, Math.round(performance.now() - started)),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return predictions;
}

async function runHostedJev(
  cases: readonly RecommendationBenchmarkCase[],
  options: CliOptions,
): Promise<{ predictions: (BenchmarkPrediction | undefined)[]; execution: unknown }> {
  const registry = await createGatewayRegistry(options.authProfile);
  const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "recommend-agent-benchmark-"));
  const selected = cases.slice(0, options.all ? cases.length : options.limit);
  try {
    const execution = await runWithHostedRetries(
      selected,
      {
        pacingDelayMs: 1000,
        maxAttempts: DEFAULT_HOSTED_MAX_ATTEMPTS,
        retryBaseMs: DEFAULT_HOSTED_RETRY_BASE_MS,
        retryCapMs: DEFAULT_HOSTED_RETRY_CAP_MS,
        maxCaseWaitMs: DEFAULT_HOSTED_MAX_CASE_WAIT_MS,
        maxRunWaitMs: DEFAULT_HOSTED_MAX_RUN_WAIT_MS,
      },
      async (index) => {
        const testCase = selected[index];
        if (!testCase)
          return {
            names: [],
            unavailable: true,
            failure: { stage: "evaluation", reason: "missing-fixture" },
          };
        materializeCatalog(root, testCase.denied);
        const started = performance.now();
        const evaluation = await recommendAgent(
          { task: testCase.task, intent: testCase.intent },
          {
            modelRegistry: registry,
            config: { ...DEFAULT_RECOMMEND_AGENT_CONFIG, enabled: true },
            discovery: { cwd: root, projectTrusted: false, agentDir: root },
          },
        );
        return predictionFromEvaluation(evaluation, Math.round(performance.now() - started));
      },
    );
    const predictions: (BenchmarkPrediction | undefined)[] = Array.from({ length: cases.length });
    for (const result of execution.cases) predictions[result.caseIndex] = result.prediction;
    return { predictions, execution };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function parsePrimaryChoice(
  text: string | undefined,
  choices: readonly string[],
): string | undefined {
  if (!text) return undefined;
  const match = text.match(/\{\s*["']choice["']\s*:\s*["']([^"']+)["']\s*\}/u);
  const choice = match?.[1];
  return choice !== undefined && choices.includes(choice) ? choice : undefined;
}

async function runPrimaryBaseline(
  cases: readonly RecommendationBenchmarkCase[],
  options: CliOptions,
): Promise<(BenchmarkPrediction | undefined)[]> {
  const predictions: (BenchmarkPrediction | undefined)[] = Array.from({ length: cases.length });
  if (!options.primaryModel) return predictions;
  const runtime = await ModelRuntime.create({ refreshOnCreate: false });
  const resolved = resolveCliModel({ cliModel: options.primaryModel, modelRuntime: runtime });
  if (!resolved.model) throw new Error(resolved.error ?? "primary model could not be resolved");
  const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "recommend-agent-primary-"));
  const selected = cases.slice(0, options.all ? cases.length : options.limit);
  try {
    for (const [index, testCase] of selected.entries()) {
      if (testCase.explicitSkillInvocation === true) {
        predictions[index] = { names: [] };
        continue;
      }
      materializeCatalog(root, testCase.denied);
      const catalog = discoverAgentDefinitions({
        cwd: root,
        projectTrusted: false,
        agentDir: root,
      }).catalog;
      if (!catalog) {
        predictions[index] = {
          names: [],
          unavailable: true,
          failure: { stage: "evaluation", reason: "catalog-unavailable" },
        };
        continue;
      }
      const loader = new DefaultResourceLoader({
        cwd: root,
        agentDir: root,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: "Route one scoped task. Never invoke tools. Return only JSON.",
      });
      await loader.reload();
      const { session } = await createAgentSession({
        cwd: root,
        agentDir: root,
        modelRuntime: runtime,
        model: resolved.model,
        thinkingLevel: "off",
        noTools: "all",
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(root),
      });
      const started = performance.now();
      try {
        await session.prompt(
          JSON.stringify({
            task: testCase.task,
            intent: testCase.intent,
            agents: catalog.definitions.map(({ id, description }) => ({ id, description })),
            options: ["stay", "abstain"],
            output: 'Return exactly {"choice":"id"}; choose an agent id, stay, or abstain.',
          }),
          { expandPromptTemplates: false, source: "rpc" },
        );
        const choices = [...catalog.definitions.map(({ id }) => id), "stay", "abstain"];
        const choice = parsePrimaryChoice(session.getLastAssistantText(), choices);
        predictions[index] =
          choice === undefined
            ? {
                names: [],
                latencyMs: Math.round(performance.now() - started),
                unavailable: true,
                failure: { stage: "evaluation", reason: "invalid-primary-response" },
              }
            : { names: [choice], latencyMs: Math.round(performance.now() - started) };
      } finally {
        session.dispose();
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return predictions;
}

function parsePositive(value: string, name: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_CASES)
    throw new Error(`${name} must be an integer from 1 to ${MAX_CASES}`);
  return number;
}

function usage(): string {
  return [
    "Usage: bun benchmarks/recommend-agent.ts [--mock | --jev | --primary provider/model] [options]",
    "",
    "Offline mock is the default and performs no paid calls.",
    "Hosted modes are opt-in; without --all they evaluate one case by default.",
    "Options:",
    "  --mock                 Run the deterministic mocked Jev-shaped benchmark (default)",
    "  --jev                  Run the hosted TypeSafe Jev benchmark",
    "  --primary MODEL        Run the opt-in primary-model baseline",
    "  --limit N              Hosted cases to attempt (1-13)",
    "  --all                  Explicitly attempt every fixture",
    "  --auth-profile NAME    Gateway auth profile (default: default)",
    "  --output PATH          Write the bounded JSON report",
  ].join("\n");
}

function parseCli(argv: readonly string[]): CliOptions {
  let mode: RunMode = "mock-jev";
  let limit = DEFAULT_HOSTED_LIMIT;
  let all = false;
  let output: string | undefined;
  let authProfile = "default";
  let primaryModel: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === "--help") {
      console.log(usage());
      process.exit(0);
    } else if (argument === "--mock") mode = "mock-jev";
    else if (argument === "--jev") mode = "jev";
    else if (argument === "--primary" && next !== undefined) {
      mode = "primary";
      primaryModel = next;
      index += 1;
    } else if (argument === "--limit" && next !== undefined) {
      limit = parsePositive(next, "limit");
      index += 1;
    } else if (argument === "--all") all = true;
    else if (argument === "--auth-profile" && next !== undefined) {
      if (!/^[A-Za-z0-9._-]+$/u.test(next)) throw new Error("auth profile name is invalid");
      authProfile = next;
      index += 1;
    } else if (argument === "--output" && next !== undefined) {
      output = next;
      index += 1;
    } else throw new Error(`unknown option: ${argument}`);
  }
  if (mode === "primary" && primaryModel === undefined) throw new Error("--primary requires MODEL");
  return {
    mode,
    limit,
    all,
    ...(output === undefined ? {} : { output }),
    authProfile,
    ...(primaryModel === undefined ? {} : { primaryModel }),
  };
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const cases = RECOMMEND_AGENT_BENCHMARK_CASES;
  const metricsInput = metricsCases(cases);
  const lexical = calculateBenchmarkMetrics(metricsInput, cases.map(lexicalPrediction));
  const report: Record<string, unknown> = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    benchmark: "recommend-agent",
    catalogKind: "discovered-definitions",
    catalogAgentIds: RECOMMEND_AGENT_BENCHMARK_CATALOG.map(({ id }) => id),
    fixtureCount: cases.length,
    hostedLimit: options.all ? cases.length : options.limit,
    lexicalBaseline: lexical,
    notes: [
      "Fixture names and expected labels stay outside evaluator state.",
      "Catalog definitions are synthetic snapshots of actual agent IDs; native execution must re-check availability and permission.",
      "Thresholds are conservative operating values, not calibrated probabilities.",
    ],
  };

  if (options.mode === "mock-jev") {
    const predictions = await runMockJev(cases);
    report.mockJev = {
      metrics: calculateBenchmarkMetrics(metricsInput, predictions),
      preferenceOutcomes: preferenceMetrics(cases, predictions),
    };
  } else if (options.mode === "jev") {
    const run = await runHostedJev(cases, options);
    report.hostedJev = {
      metrics: calculateBenchmarkMetrics(metricsInput, run.predictions),
      preferenceOutcomes: preferenceMetrics(cases, run.predictions),
    };
    report.hostedExecution = run.execution;
  } else {
    const predictions = await runPrimaryBaseline(cases, options);
    report.primaryBaseline = {
      metrics: calculateBenchmarkMetrics(metricsInput, predictions),
      preferenceOutcomes: preferenceMetrics(cases, predictions),
    };
    report.primaryModel = options.primaryModel;
  }

  const serialized = JSON.stringify(report, null, 2);
  if (options.output) {
    mkdirSync(join(options.output, ".."), { recursive: true });
    writeFileSync(options.output, `${serialized}\n`);
  }
  console.log(serialized);
}

if (import.meta.main) {
  await main();
}
