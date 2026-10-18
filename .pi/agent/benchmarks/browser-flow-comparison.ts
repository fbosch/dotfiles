import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type ClassifierRegistry,
  createClassifierRequester,
  resolveClassifierEnabled,
  resolveClassifierPreferences,
} from "../lib/classifier";
import { type Options, openRuntime, type RuntimeSdk } from "./browser-comparison";
import {
  addUsage,
  type Call,
  median,
  type TokenTotals,
  tokenTotals,
} from "./browser-comparison-metrics";
import {
  createFlowFixture,
  FLOW_EFFECT_BUDGET,
  FLOW_IDS,
  type FlowId,
  type FlowVerdict,
  judgeFlow,
} from "./browser-flow-fixture";

const NATIVE = "mcp__chrome_devtools__";
export type Controller = "classifier" | "luna" | "codemode";
interface FlowOptions {
  baseline: "luna" | "codemode";
  warmups: number;
  sdkRoot: string;
  output: string;
  runs: number;
  flows: FlowId[];
  mode: "measure" | "replay" | "preflight";
  model: string;
  timeoutMs: number;
  maxTurns: number;
  chrome: string;
}
export interface FlowSample {
  warmup: boolean;
  commitMs: number | null;
  flowId: FlowId;
  controller: Controller;
  repetition: number;
  initialFingerprint: string;
  success: boolean;
  invalidEnvironment: boolean;
  durationMs: number;
  verdict: FlowVerdict;
  finalView: string;
  calls: Call[];
  primaryResponses: number;
  primaryUsage: TokenTotals;
  classifierUsage: TokenTotals;
  classifierCalls: number;
  classifierAttempts: number;
  classifierModels: string[];
  classifierFailures: { reason: string; stage: string }[];
  stopReasons: string[];
  runDetails: unknown[];
  error?: string;
}

export function parseFlowOptions(args: readonly string[]): FlowOptions {
  const names = new Set([
    "--sdk-root",
    "--baseline",
    "--warmups",
    "--output",
    "--runs",
    "--flows",
    "--mode",
    "--model",
    "--timeout-ms",
    "--max-turns",
    "--chrome",
  ]);
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i],
      value = args[i + 1];
    if (!name || !names.has(name) || !value || value.startsWith("--") || values.has(name))
      throw new Error("Expected unique named options followed by values");
    values.set(name, value);
  }
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(values.get(key) ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`Invalid ${key}`);
    return value;
  };
  const sdkRoot = values.get("--sdk-root");
  if (!sdkRoot)
    throw new Error(
      "--sdk-root is required; use the installed Pi SDK, not an unresolved project catalog",
    );
  const mode = values.get("--mode") ?? "measure";
  if (mode !== "measure" && mode !== "replay" && mode !== "preflight")
    throw new Error("Invalid --mode");
  const flows = (values.get("--flows") ?? FLOW_IDS.join(",")).split(",");
  if (
    !flows.every((id): id is FlowId => FLOW_IDS.some((flow) => flow === id)) ||
    new Set(flows).size !== flows.length
  )
    throw new Error("Invalid or duplicate --flows");
  const baseline = values.get("--baseline") ?? "codemode";
  if (baseline !== "luna" && baseline !== "codemode") throw new Error("Invalid --baseline");
  const model = values.get("--model") ?? "openai-codex/gpt-6-luna";
  if (!/^[^/]+\/.+$/u.test(model)) throw new Error("Expected --model provider/model");
  return {
    baseline,
    warmups: integer("--warmups", 0, 0, 2),
    sdkRoot: resolve(sdkRoot),
    output: resolve(values.get("--output") ?? join(tmpdir(), `pi-browser-flows-${Date.now()}`)),
    runs: integer("--runs", 1, 1, 5),
    flows,
    mode,
    model,
    timeoutMs: integer("--timeout-ms", 180_000, 1_000, 300_000),
    maxTurns: integer("--max-turns", 32, 1, 64),
    chrome: values.get("--chrome") ?? "/run/current-system/sw/bin/google-chrome",
  };
}

export async function loadRuntimeSdk(root: string): Promise<RuntimeSdk> {
  const sdk: unknown = await import(pathToFileURL(join(root, "dist/index.js")).href);
  const exports = [
    "createAgentSession",
    "createCodemodeExtension",
    "createMcpExtension",
    "DefaultResourceLoader",
    "getAgentDir",
    "ModelRegistry",
    "ModelRuntime",
    "SessionManager",
    "SettingsManager",
  ];
  if (
    typeof sdk !== "object" ||
    sdk === null ||
    exports.some((name) => !(name in sdk) || typeof Reflect.get(sdk, name) !== "function") ||
    !("VERSION" in sdk) ||
    typeof sdk.VERSION !== "string"
  )
    throw new Error("SDK entry does not expose the required benchmark runtime API");
  return sdk as RuntimeSdk;
}

export function infrastructureFailure(
  failures: readonly { reason: string; stage: string }[],
): boolean {
  return failures.some((failure) => failure.stage === "config" || failure.stage === "auth");
}

export function summarizeFlows(samples: readonly FlowSample[]) {
  const measured = samples.filter((sample) => !sample.warmup);
  const valid = measured.filter((sample) => !sample.invalidEnvironment);
  const controllers = [...new Set(valid.map((sample) => sample.controller))];
  return {
    groups: controllers.map((controller) => {
      const group = valid.filter((sample) => sample.controller === controller);
      const completed = group.filter((sample) => sample.success && sample.commitMs !== null);
      return {
        controller,
        samples: group.length,
        successful: completed.length,
        medianMs: median(group.map((sample) => sample.durationMs)),
        medianCommitMs: completed.length
          ? median(
              completed.flatMap((sample) => (sample.commitMs === null ? [] : [sample.commitMs])),
            )
          : null,
        primaryResponses: group.reduce((n, sample) => n + sample.primaryResponses, 0),
        primaryTokens: group.reduce((n, sample) => n + sample.primaryUsage.total, 0),
        classifierCalls: group.reduce((n, sample) => n + sample.classifierCalls, 0),
        classifierAttempts: group.reduce((n, sample) => n + sample.classifierAttempts, 0),
        classifierTokens: group.reduce((n, sample) => n + sample.classifierUsage.total, 0),
        reportedCostUsd: group.reduce(
          (n, sample) =>
            n + sample.primaryUsage.reportedCostUsd + sample.classifierUsage.reportedCostUsd,
          0,
        ),
        missingUsageCalls: group.reduce(
          (n, sample) =>
            n + sample.primaryUsage.missingUsageCalls + sample.classifierUsage.missingUsageCalls,
          0,
        ),
      };
    }),
    paired: valid
      .filter((sample) => sample.controller === "classifier")
      .flatMap((classifier) => {
        const matches = valid.filter(
          (sample) =>
            sample.controller !== "classifier" &&
            sample.flowId === classifier.flowId &&
            sample.repetition === classifier.repetition,
        );
        const primary = matches[0];
        if (
          matches.length !== 1 ||
          !primary ||
          primary.initialFingerprint !== classifier.initialFingerprint
        )
          return [];
        return [
          {
            flowId: classifier.flowId,
            repetition: classifier.repetition,
            primaryController: primary.controller,
            classifierSuccess: classifier.success,
            primarySuccess: primary.success,
            classifierMs: classifier.durationMs,
            primaryMs: primary.durationMs,
            classifierCommitMs: classifier.commitMs,
            primaryCommitMs: primary.commitMs,
          },
        ];
      }),
    warmups: samples
      .filter((sample) => sample.warmup)
      .map((sample) => ({
        flowId: sample.flowId,
        controller: sample.controller,
        success: sample.success,
      })),
    invalidSamples: measured.filter((sample) => sample.invalidEnvironment).length,
  };
}

type Runtime = Awaited<ReturnType<typeof openRuntime>>;
type Fixture = ReturnType<typeof createFlowFixture>;
type Trial = ReturnType<Fixture["create"]>;

function helperOptions(options: FlowOptions, classifierDirectory: string): Options {
  const slash = options.model.indexOf("/");
  return {
    phase: options.mode === "replay" ? "scripted" : "agent",
    provider: options.model.slice(0, slash),
    model: options.model.slice(slash + 1),
    thinking: options.mode === "replay" ? "off" : "high",
    runs: options.runs,
    warmups: 0,
    cases: [],
    output: options.output,
    timeoutMs: options.timeoutMs,
    maxTurns: options.maxTurns,
    executable: options.chrome,
    classifierDirectory,
    maxActions: FLOW_EFFECT_BUDGET,
  };
}

function contentText(result: { content: readonly { type: string; text?: string }[] }) {
  return result.content
    .filter((content) => content.type === "text")
    .map((content) => content.text ?? "")
    .join("\n");
}
function runStop(result: { details?: unknown }): string {
  const details = result.details;
  if (
    typeof details !== "object" ||
    details === null ||
    !("stopReason" in details) ||
    typeof details.stopReason !== "string"
  )
    throw new Error("browser_run omitted its stop reason");
  return details.stopReason;
}
async function shutdown(runtime: Runtime) {
  try {
    await runtime.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  } finally {
    runtime.session.dispose();
  }
}

async function classifierWork(h: Runtime, page: Trial, pageId: number, options: FlowOptions) {
  const signal = AbortSignal.timeout(options.timeoutMs);
  // Mechanical budget renewal is not a primary-model rescue or an oracle-guided action.
  for (let remaining = FLOW_EFFECT_BUDGET; remaining > 0; remaining -= 10) {
    const result = await h.execute(
      "browser_run",
      {
        backend: "chrome",
        pageId,
        objective: page.objective,
        inputs: page.inputs,
        maxSteps: Math.min(10, remaining),
      },
      signal,
    );
    const stop = runStop(result);
    if (stop !== "max_steps") return;
  }
  throw new Error("Classifier action budget exhausted");
}

async function lunaWork(
  h: Runtime,
  page: Trial,
  pageId: number,
  options: FlowOptions,
  controller: "luna" | "codemode",
) {
  const codemode = controller === "codemode";
  h.session.setActiveToolsByName(codemode ? ["codemode"] : ["browser_snapshot", "browser_act"]);
  let turns = 0,
    actions = 0;
  let stopped: string | undefined;
  const off = h.session.subscribe((event) => {
    if (
      event.type === "tool_execution_start" &&
      event.toolName === "browser_act" &&
      ++actions > FLOW_EFFECT_BUDGET
    ) {
      stopped = "action-budget";
      void h.session.abort();
    }
    if (
      event.type === "turn_end" &&
      ++turns >= options.maxTurns &&
      event.message.role === "assistant" &&
      event.message.stopReason === "toolUse"
    ) {
      stopped = "turn-budget";
      void h.session.abort();
    }
  });
  const timer = setTimeout(() => {
    stopped = "timeout";
    void h.session.abort();
  }, options.timeoutMs);
  try {
    const protocol = codemode
      ? `Use only codemode calling native Chrome MCP tools. Browser wrappers, filesystem/shell tools, page JavaScript, direct HTTP, private fixture state, and classifier models are forbidden.
Batch compatible calls in a script. Use fill_form for multiple fields rather than parallel keyboard operations.
Read actual native snapshots for current UIDs, review, save, and observe the final confirmation. Do not ask questions.
Native tool schemas, prepared before timing: ${JSON.stringify(h.nativeSchemas)}`
      : 'Use browser_snapshot and browser_act only. Pass refs such as e1 as "@e1". Take fresh full snapshots with interactiveOnly:false and includeUrls:true after each action. Never use page JavaScript or private fixture state.';
    await h.session.prompt(`${page.objective}
Supplied inputs: ${JSON.stringify(page.inputs)}.
Current Chrome pageId: ${pageId}. Stay on this page. ${codemode ? "Native MCP calls take pageId, not a browser-wrapper backend." : 'Use backend "chrome".'}
${protocol}
Resolve displayed validation errors. Stop after observing the requested final confirmation.
At most ${FLOW_EFFECT_BUDGET} actions are allowed. Do not ask questions.`);
    if (stopped) throw new Error(stopped);
    const last = [...h.session.messages].reverse().find((message) => message.role === "assistant");
    if (
      last?.role === "assistant" &&
      (last.stopReason === "error" || last.stopReason === "aborted")
    )
      throw new Error(last.errorMessage ?? last.stopReason);
  } finally {
    clearTimeout(timer);
    off();
  }
}

async function writeTrace(h: Runtime, path: string) {
  const trace = h.session.messages
    .filter((message) => message.role === "assistant" || message.role === "toolResult")
    .map((message) =>
      message.role === "assistant"
        ? {
            role: message.role,
            provider: message.provider,
            model: message.model,
            stopReason: message.stopReason,
            calls: message.content.filter((content) => content.type === "toolCall"),
          }
        : message,
    );
  await writeFile(path, `${JSON.stringify(trace, null, 2)}\n`);
}

async function sample(
  h: Runtime,
  fixture: Fixture,
  options: FlowOptions,
  flowId: FlowId,
  controller: Controller,
  repetition: number,
  warmup: boolean,
): Promise<FlowSample> {
  const page = fixture.create(flowId, `pair:${flowId}:${repetition}`);
  let pageId: number | undefined;
  let commitMs: number | null = null;
  let off = () => {};
  try {
    const opened = await h.call(`${NATIVE}new_page`, { url: page.url });
    const id = /^\s*(\d+):.*\[selected\]\s*$/mu.exec(opened)?.[1];
    if (!id) throw new Error("Chrome did not return a page ID");
    pageId = Number(id);
    await h.call(`${NATIVE}take_snapshot`, { pageId });
    const started = performance.now();
    off = page.onChange(() => {
      if (commitMs === null && judgeFlow(page.state()).success)
        commitMs = performance.now() - started;
    });
    h.ledger.measuring = true;
    let error: string | undefined;
    try {
      if (controller === "classifier") await classifierWork(h, page, pageId, options);
      else await lunaWork(h, page, pageId, options, controller);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    const durationMs = performance.now() - started;
    h.ledger.measuring = false;
    await h.call(`${NATIVE}evaluate_script`, {
      pageId,
      function: "async () => { await window.benchmarkPending; return true; }",
    });
    const state = page.state(),
      verdict = judgeFlow(state);
    const primaryUsage = tokenTotals();
    let primaryResponses = 0;
    for (const message of h.session.messages) {
      if (message.role !== "assistant" || message.provider === "benchmark-controller") continue;
      primaryResponses++;
      addUsage(primaryUsage, message.usage);
    }
    const invalidEnvironment =
      infrastructureFailure(h.ledger.classifierFailures) ||
      (error !== undefined &&
        /not supported when using Codex|Model not found|No API key|authentication/i.test(error));
    const result: FlowSample = {
      flowId,
      controller,
      repetition,
      warmup,
      commitMs,
      initialFingerprint: page.initialFingerprint,
      success: verdict.success && error === undefined && commitMs !== null,
      invalidEnvironment,
      durationMs,
      verdict,
      finalView: state.view,
      calls: h.ledger.calls,
      primaryResponses,
      primaryUsage,
      classifierUsage: h.ledger.classifierUsage,
      classifierCalls: h.ledger.classifierCalls,
      classifierAttempts: h.ledger.classifierAttempts,
      classifierModels: [...h.ledger.classifierModels],
      classifierFailures: h.ledger.classifierFailures,
      stopReasons: h.ledger.stopReasons,
      runDetails: h.ledger.runDetails,
      ...(error ? { error: error.slice(0, 1000) } : {}),
    };
    const prefix = `${warmup ? "warmup-" : ""}${flowId}-${controller}-${repetition}`;
    await writeTrace(h, join(options.output, `trace-${prefix}.json`));
    await writeFile(
      join(options.output, `state-${prefix}.json`),
      `${JSON.stringify(state, null, 2)}\n`,
    );
    return result;
  } finally {
    off();
    h.ledger.measuring = false;
    try {
      if (pageId !== undefined) await h.call(`${NATIVE}close_page`, { pageId });
    } finally {
      page.dispose();
    }
  }
}

function ref(snapshot: string, label: string, occurrence = 0) {
  const matches = snapshot.split("\n").filter((line) => {
    const match = /^- \w+ ("(?:\\.|[^"\\])*") \[ref=/u.exec(line);
    return match?.[1] !== undefined && JSON.parse(match[1]) === label;
  });
  const match = /\bref=(e\d+)/u.exec(matches[occurrence] ?? "");
  if (!match?.[1]) throw new Error(`Missing replay control ${label} #${occurrence}`);
  return `@${match[1]}`;
}

async function replay(h: Runtime, fixture: Fixture, flowId: FlowId, output: string) {
  const page = fixture.create(flowId, `replay:${flowId}`);
  let pageId: number | undefined;
  try {
    const opened = await h.call(`${NATIVE}new_page`, { url: page.url });
    const id = /^\s*(\d+):.*\[selected\]\s*$/mu.exec(opened)?.[1];
    if (!id) throw new Error("Missing replay page ID");
    pageId = Number(id);
    const act = async (label: string, action: string, value?: string, occurrence = 0) => {
      const snapshot = await h.call("browser_snapshot", {
        backend: "chrome",
        pageId,
        interactiveOnly: false,
        includeUrls: true,
      });
      await h.execute("browser_act", {
        backend: "chrome",
        pageId,
        action,
        target: ref(snapshot, label, occurrence),
        ...(value === undefined ? {} : { value }),
      });
      await h.call(`${NATIVE}evaluate_script`, {
        pageId,
        function: "async () => { await window.benchmarkPending; return true; }",
      });
    };
    if (flowId === "form") {
      await act("Organization name", "fill", "Nordlys Århus");
      await act("Billing email", "fill", "billing@example.test");
      await act("Review contact", "click");
      await act("Save contact", "click");
    } else if (flowId === "onboarding") {
      await act("Business account", "click");
      await act("Organization name", "fill", "Nordlys Århus");
      await act("Continue to billing", "click");
      await act("Email", "fill", "billing@example.test", 1);
      await act("Accept account terms", "check");
      await act("Review account", "click");
      await act("Create account", "click");
    } else if (flowId === "recovery") {
      await act("Open INV-204", "click");
      await act("Reference", "fill", "PO-2026-147");
      await act("Memo", "fill", "October services");
      await act("Review invoice", "click");
      await act("Billing details", "click");
      await act("Confirm billing address", "check");
      await act("Return to invoice", "click");
      await act("Review invoice", "click");
      await act("Save invoice", "click");
    } else {
      await act("Order number", "fill", "ORD-42");
      await act("Search orders", "click");
      await act("Open ORD-42", "click");
      const snapshot = await h.call("browser_snapshot", {
        backend: "chrome",
        pageId,
        interactiveOnly: false,
        includeUrls: true,
      });
      const code = /KX-[a-f0-9]{8}/u.exec(snapshot)?.[0];
      if (!code) throw new Error("Pickup code missing from rendered snapshot");
      await act("Open fulfillment", "click");
      await act("Contact email", "fill", "pickup@example.test");
      await act("Pickup code", "fill", code);
      await act("Review pickup", "click");
      await act("Confirm pickup", "click");
    }
    const verdict = judgeFlow(page.state());
    if (!verdict.success) throw new Error(`Replay oracle failed: ${JSON.stringify(verdict)}`);
    return { flowId, verdict };
  } catch (error) {
    await writeFile(
      join(output, `replay-failure-${flowId}.json`),
      JSON.stringify(
        {
          error: String(error),
          state: page.state(),
          snapshot:
            pageId === undefined
              ? undefined
              : await h.call("browser_snapshot", {
                  backend: "chrome",
                  pageId,
                  interactiveOnly: false,
                  includeUrls: true,
                }),
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    try {
      if (pageId !== undefined) await h.call(`${NATIVE}close_page`, { pageId });
    } finally {
      page.dispose();
    }
  }
}

async function main() {
  const options = parseFlowOptions(process.argv.slice(2));
  await mkdir(options.output, { recursive: true });
  const samples: FlowSample[] = [];
  const fixture = createFlowFixture();
  let complete = false,
    fatal: string | undefined;
  let preflight: unknown;
  try {
    const sdk = await loadRuntimeSdk(options.sdkRoot);
    const settings = sdk.SettingsManager.create(homedir(), sdk.getAgentDir(), {
      projectTrusted: false,
    });
    const globalSettings = settings.getGlobalSettings();
    if (
      settings.drainErrors().length ||
      resolveClassifierEnabled(globalSettings, undefined) !== true
    )
      throw new Error("Classifier policy is disabled or invalid; preflight stopped");
    const preferences = resolveClassifierPreferences(globalSettings);
    if (!preferences?.length) throw new Error("Classifier preferences are invalid");
    const classifierDirectory = join(options.output, "classifier-settings");
    await mkdir(classifierDirectory, { recursive: true });
    await writeFile(
      join(classifierDirectory, "settings.json"),
      JSON.stringify(
        {
          classifier: { enabled: true, providers: preferences, imageProviders: preferences },
        },
        null,
        2,
      ),
    );
    const runtime = await sdk.ModelRuntime.create({ allowModelNetwork: false });
    const registry = new sdk.ModelRegistry(runtime);
    const lookups = preferences.map((preference) => ({
      ...preference,
      resolved:
        registry.findOfType("classifier", preference.provider, preference.model) !== undefined,
    }));
    if (lookups.some((lookup) => !lookup.resolved))
      throw new Error(`Classifier catalog preflight failed: ${JSON.stringify(lookups)}`);
    const files = [
      "browser-flow-comparison.ts",
      "browser-flow-fixture.ts",
      "browser-comparison.ts",
      "../extensions/browser/index.ts",
      "../extensions/browser/backends.ts",
      "../lib/classifier.ts",
    ];
    const provenance = await Promise.all(
      files.map(async (path) => ({
        path,
        sha256: createHash("sha256")
          .update(await readFile(new URL(path, import.meta.url)))
          .digest("hex"),
      })),
    );
    const metadata = {
      schemaVersion: 2,
      sdkRoot: options.sdkRoot,
      sdkVersion: sdk.VERSION,
      runtime: `Bun ${Bun.version}`,
      model: options.model,
      thinking: "high",
      controllers: ["classifier", options.baseline],
      flows: options.flows,
      repetitions: options.runs,
      warmups: options.warmups,
      mode: options.mode,
      classifierPreferences: preferences,
      classifierSettingsSha256: createHash("sha256")
        .update(JSON.stringify(preferences))
        .digest("hex"),
      budget: {
        effects: FLOW_EFFECT_BUDGET,
        timeoutMs: options.timeoutMs,
        primaryTurns: options.maxTurns,
        classifierChunks: 2,
        classifierStepsPerChunk: 10,
      },
      provenance,
      isolation:
        "Fresh isolated Chrome per trial, trusted local fixtures only, no personal profile",
      chromeArgs: ["--no-sandbox", "--ozone-platform=headless"],
      comparison:
        "Same goal, explicit inputs, seeded initial state, browser adapters, action/effect budget and independent oracle",
      controllerPolicy:
        "Classifier-only browser_run without primary rescue. Codemode baseline uses Luna-high and native Chrome MCP only, with batching allowed and native schemas prepared before timing. Wrapper baseline remains separately selectable.",
      cases: {
        form: "Two uniquely named fields, review, save",
        onboarding: "Conditional branch and ambiguous billing controls",
        recovery: "Resolve validation and retry the same action",
        handoff: "Capability boundary: carry newly discovered data between pages",
      },
      timing:
        "commitMs measures start to independent server-side successful save; durationMs measures start to controller return. Excludes setup, API/schema preparation, verification, persistence and cleanup. Includes primary planning and script generation.",
      costs:
        "Provider-reported estimates, not billing receipts; preflight cost separate; missing usage retained",
      limitations: [
        "Small local pilot; no significance or production-site claim",
        "Classifier inputs may be filled deterministically; runDetails records classifier versus deterministic steps",
        "No project production permission extensions; shared browser execution layer only",
      ],
    };
    await writeFile(
      join(options.output, "metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
    );
    const request = createClassifierRequester(Date.now, classifierDirectory);
    if (options.mode !== "replay") {
      const models: string[] = [];
      const tracked: ClassifierRegistry = {
        findOfType: registry.findOfType.bind(registry),
        async classify(model, context, config) {
          models.push(`${model.provider}/${model.id}`);
          return registry.classify(model, context, config);
        },
      };
      let attempts = 0;
      const result = await request(
        tracked,
        {
          state: { left: "fixture", right: "fixture" },
          questions: {
            equal: {
              type: "bool",
              instructions: "Are left and right identical strings?",
              criteria: { true: "The strings are identical.", false: "The strings differ." },
            },
          },
        },
        { timeoutMs: 15_000, onFetchAttempt: () => attempts++ },
      );
      preflight = { result, models, attempts };
      await writeFile(
        join(options.output, "preflight.json"),
        `${JSON.stringify(preflight, null, 2)}\n`,
      );
      if (
        !result.ok ||
        result.value.answers.equal?.type !== "bool" ||
        result.value.answers.equal.probability < 0.9 ||
        attempts < 1
      )
        throw new Error("Native classifier semantic/availability preflight failed");
    }
    const helper = helperOptions(options, classifierDirectory);
    if (options.mode !== "replay") {
      const h = await openRuntime(helper, runtime, "deterministic", false, sdk);
      const timer = setTimeout(
        () => {
          void h.session.abort();
        },
        Math.min(60_000, options.timeoutMs),
      );
      try {
        h.session.setActiveToolsByName([]);
        await h.session.prompt("Reply with exactly READY. Do not call tools.");
        const last = [...h.session.messages]
          .reverse()
          .find(
            (message) =>
              message.role === "assistant" && message.provider !== "benchmark-controller",
          );
        if (
          last?.role !== "assistant" ||
          last.stopReason === "error" ||
          last.stopReason === "aborted" ||
          contentText(last).trim() !== "READY"
        )
          throw new Error(
            last?.role === "assistant"
              ? (last.errorMessage ?? "Luna preflight did not return READY")
              : "Luna preflight returned no response",
          );
        preflight = {
          classifier: preflight,
          primary: {
            provider: last.provider,
            model: last.model,
            thinking: "high",
            usage: last.usage,
          },
        };
        await writeFile(
          join(options.output, "preflight.json"),
          `${JSON.stringify(preflight, null, 2)}\n`,
        );
      } finally {
        clearTimeout(timer);
        await shutdown(h);
      }
    }
    if (options.mode === "replay") {
      const replays = [];
      for (const flowId of options.flows) {
        const h = await openRuntime(helper, runtime, "deterministic", true, sdk);
        try {
          replays.push(await replay(h, fixture, flowId, options.output));
        } finally {
          await shutdown(h);
        }
      }
      await writeFile(join(options.output, "replay.json"), `${JSON.stringify(replays, null, 2)}\n`);
      console.log(JSON.stringify({ replayed: replays }));
    } else if (options.mode === "measure") {
      for (let repetition = -options.warmups; repetition < options.runs; repetition++) {
        for (const [index, flowId] of options.flows.entries()) {
          const controllers: Controller[] =
            (index + repetition) % 2 === 0
              ? ["classifier", options.baseline]
              : [options.baseline, "classifier"];
          for (const controller of controllers) {
            const h = await openRuntime(
              { ...helper, codemode: controller === "codemode" },
              runtime,
              controller === "classifier"
                ? "orchestrated"
                : controller === "codemode"
                  ? "raw"
                  : "deterministic",
              false,
              sdk,
            );
            try {
              const result = await sample(
                h,
                fixture,
                options,
                flowId,
                controller,
                repetition,
                repetition < 0,
              );
              samples.push(result);
              await appendFile(
                join(options.output, "samples.jsonl"),
                `${JSON.stringify(result)}\n`,
              );
              console.log(
                JSON.stringify({
                  flowId,
                  controller,
                  repetition,
                  success: result.success,
                  invalidEnvironment: result.invalidEnvironment,
                  ms: Math.round(result.durationMs),
                  commitMs: result.commitMs,
                  warmup: result.warmup,
                  classifierCalls: result.classifierCalls,
                  classifierAttempts: result.classifierAttempts,
                  primaryResponses: result.primaryResponses,
                  finalView: result.finalView,
                  error: result.error,
                }),
              );
              if (result.warmup && !result.success)
                throw new Error("Workflow preflight failed; measured trials were not started");
              if (result.invalidEnvironment)
                throw new Error(
                  "Environment failure during measurement; subsequent trials stopped",
                );
            } finally {
              await shutdown(h);
            }
          }
        }
      }
    }
    complete = true;
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    fixture.stop();
    const report = { complete, ...(fatal ? { fatal } : {}), preflight, ...summarizeFlows(samples) };
    await writeFile(join(options.output, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify({ complete, output: options.output, samples: samples.length, fatal }),
    );
  }
  if (complete && samples.some((sample) => !sample.success)) process.exitCode = 2;
}
if (import.meta.main) await main();
