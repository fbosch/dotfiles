import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  DefaultResourceLoader,
  type ExtensionAPI,
  type ExtensionFactory,
  getAgentDir,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  VERSION,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import browserExtension from "../extensions/browser";
import { type ClassifierRegistry, createClassifierRequester } from "../lib/classifier";
import { CASES, type CaseId, createFixture, EMAIL, judge } from "./browser-comparison-fixture";
import {
  type Arm,
  addUsage,
  type Call,
  orderedArms,
  type Sample,
  summarize,
  tokenTotals,
} from "./browser-comparison-metrics";

const NATIVE = "mcp__chrome_devtools__";
export const CODEMODE_NATIVE_TOOLS = [
  "take_snapshot",
  "fill_form",
  "fill",
  "click",
  "wait_for",
  "press_key",
] as const;
const HOST = "benchmark_dispatch";
const SOURCE_FILES = [
  "extensions/browser/index.ts",
  "extensions/browser/backends.ts",
  "extensions/browser/prompt.ts",
  "lib/classifier.ts",
  "benchmarks/browser-comparison.ts",
  "benchmarks/browser-comparison-fixture.ts",
  "benchmarks/browser-comparison-metrics.ts",
];
const BASE_PROMPT =
  "Complete the user's task using only the supplied browser tools. " +
  "The page is a harmless local fixture. Do not delete accounts, change unrequested controls, " +
  "or submit twice. Use fresh snapshots when page structure changes. " +
  "Use normal browser interactions rather than JavaScript to manipulate controls. " +
  "Use console diagnostics only when the task requires them. Stop when the task is complete. " +
  "Do not ask questions or claim success without observing the result.";
export interface Options {
  phase: "scripted" | "agent";
  runs: number;
  warmups: number;
  cases: CaseId[];
  output: string;
  provider: string;
  model: string;
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  timeoutMs: number;
  maxTurns: number;
  executable: string;
  classifierDirectory?: string;
  maxActions?: number;
  codemode?: boolean;
}
export function parseOptions(args: readonly string[]): Options {
  const values = new Map<string, string>();
  const known = new Set([
    "--phase",
    "--runs",
    "--warmups",
    "--cases",
    "--output",
    "--model",
    "--thinking",
    "--timeout-ms",
    "--max-turns",
    "--chrome",
  ]);
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i],
      value = args[i + 1];
    if (!name || !known.has(name) || !value || value.startsWith("--") || values.has(name))
      throw new Error(
        "Expected unique --phase, --runs, --warmups, --cases, --output, --model, --thinking, --timeout-ms, --max-turns, or --chrome followed by a value",
      );
    values.set(name, value);
  }
  const phase = values.get("--phase") ?? "scripted";
  if (phase !== "scripted" && phase !== "agent") throw new Error("phase must be scripted or agent");
  const integer = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(values.get(name) ?? fallback);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`Invalid ${name}`);
    return value;
  };
  const cases = (
    values.get("--cases") ??
    (phase === "scripted" ? "observe,form,navigation" : "form,navigation,ambiguous,diagnostics")
  ).split(",");
  if (
    !cases.every((name): name is CaseId => CASES.some((c) => c === name)) ||
    new Set(cases).size !== cases.length
  )
    throw new Error("Unknown or duplicate case");
  if (phase === "scripted" && cases.some((name) => name === "ambiguous" || name === "diagnostics"))
    throw new Error("Scripted phase supports observe, form, and navigation");
  const modelSpec =
    values.get("--model") ?? `${process.env.PI_PROVIDER ?? ""}/${process.env.PI_MODEL ?? ""}`;
  const slash = modelSpec.indexOf("/");
  const provider = modelSpec.slice(0, slash),
    model = modelSpec.slice(slash + 1);
  if (phase === "agent" && (slash < 1 || !model))
    throw new Error("Agent phase requires --model provider/model");
  const thinking = values.get("--thinking") ?? "off";
  if (
    thinking !== "off" &&
    thinking !== "minimal" &&
    thinking !== "low" &&
    thinking !== "medium" &&
    thinking !== "high" &&
    thinking !== "xhigh"
  )
    throw new Error("Invalid --thinking level");
  const stamp = new Date().toISOString().replaceAll(":", "-");
  return {
    phase,
    runs: integer("--runs", phase === "scripted" ? 5 : 2, 1, 30),
    warmups: integer("--warmups", phase === "scripted" ? 1 : 0, 0, 5),
    cases,
    output: resolve(
      values.get("--output") ??
        join(
          process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"),
          "dotfiles/pi-benchmarks/browser-comparison",
          stamp,
        ),
    ),
    provider,
    model,
    thinking,
    timeoutMs: integer("--timeout-ms", 60_000, 1000, 180_000),
    maxTurns: integer("--max-turns", 8, 1, 12),
    executable: values.get("--chrome") ?? "/run/current-system/sw/bin/google-chrome",
  };
}
interface Ledger {
  measuring: boolean;
  calls: Call[];
  started: Map<string, number>;
  classifierCalls: number;
  classifierAttempts: number;
  classifierModels: Set<string>;
  classifierUsage: ReturnType<typeof tokenTotals>;
  stopReasons: string[];
  classifierFailures: { reason: string; stage: string }[];
  runDetails: unknown[];
  actionAttempts: number;
}
function newLedger(): Ledger {
  return {
    measuring: false,
    calls: [],
    started: new Map(),
    classifierCalls: 0,
    classifierAttempts: 0,
    classifierModels: new Set(),
    classifierUsage: tokenTotals(),
    stopReasons: [],
    classifierFailures: [],
    runDetails: [],
    actionAttempts: 0,
  };
}
function outputText(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}
export type RuntimeSdk = Pick<
  typeof import("@earendil-works/pi-coding-agent"),
  | "createAgentSession"
  | "createCodemodeExtension"
  | "createMcpExtension"
  | "DefaultResourceLoader"
  | "getAgentDir"
  | "ModelRegistry"
  | "ModelRuntime"
  | "SessionManager"
  | "SettingsManager"
  | "VERSION"
>;
const PROJECT_SDK: RuntimeSdk = {
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  VERSION,
};
export async function openRuntime(
  options: Options,
  runtime: ModelRuntime,
  arm: Arm,
  scripted: boolean,
  sdk: RuntimeSdk = PROJECT_SDK,
) {
  const classify = createClassifierRequester(Date.now, options.classifierDirectory);
  const ledger = newLedger();
  const nativeSchemas: { name: string; description: string; parameters: unknown }[] = [];
  const settingsManager = sdk.SettingsManager.inMemory({
    packages: [],
    defaultTools: [],
    retry: { enabled: false },
    compaction: { enabled: false },
    cacheWarming: "off",
  });
  const sessionManager = sdk.SessionManager.inMemory(homedir());
  // Pi requires an assistant-origin context for nested calls, including this scripted replay.
  // This synthetic controller is never sent to a provider or counted as a model inference.
  sessionManager.appendMessage({
    role: "assistant",
    api: "openai-responses",
    provider: "benchmark-controller",
    model: "scripted-controller",
    content: [],
    stopReason: "stop",
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  const extension: ExtensionFactory = (pi) => {
    pi.on("session_start", (_event, ctx) => {
      ctx.ui.notify = (message, kind) =>
        console.error(JSON.stringify({ mcpNotice: message, kind }));
    });
    pi.on("context", (event) => ({
      messages: event.messages.filter(
        (message) => message.role !== "assistant" || message.provider !== "benchmark-controller",
      ),
    }));
    pi.on("tool_call", (event) => {
      if (!ledger.measuring) return;
      if (
        options.codemode &&
        event.toolName !== "codemode" &&
        !CODEMODE_NATIVE_TOOLS.some((name) => event.toolName === NATIVE + name)
      )
        return {
          block: true,
          reason: "Codemode baseline allows only native Chrome interaction tools",
        };
      if (
        options.codemode &&
        ["fill", "fill_form", "click", "press_key"].some(
          (name) => event.toolName === NATIVE + name,
        ) &&
        options.maxActions !== undefined &&
        ++ledger.actionAttempts > options.maxActions
      )
        return { block: true, reason: "Action budget exhausted" };
      ledger.started.set(event.toolCallId, performance.now());
      ledger.calls.push({
        id: event.toolCallId,
        name: event.toolName,
        ...(event.parentToolCallId === undefined ? {} : { parent: event.parentToolCallId }),
        durationMs: 0,
        error: false,
      });
      if (
        event.toolName === "browser_act" &&
        options.maxActions !== undefined &&
        ++ledger.actionAttempts > options.maxActions
      )
        return { block: true, reason: "Action budget exhausted" };
    });
    pi.on("tool_result", (event) => {
      if (!ledger.measuring) return;
      const call = ledger.calls.find((entry) => entry.id === event.toolCallId);
      if (event.toolName === "browser_run") ledger.runDetails.push(event.details);
      if (call) {
        call.durationMs =
          performance.now() - (ledger.started.get(event.toolCallId) ?? performance.now());
        call.error = event.isError;
      }
      if (
        event.toolName === "browser_run" &&
        typeof event.details === "object" &&
        event.details !== null &&
        "stopReason" in event.details
      )
        ledger.stopReasons.push(String(event.details.stopReason));
    });
    if (scripted || arm !== "raw") {
      const allowed = new Set(
        scripted || arm === "orchestrated"
          ? ["browser_snapshot", "browser_act", "browser_run", "browser_step"]
          : ["browser_snapshot", "browser_act"],
      );
      const api: ExtensionAPI = {
        ...pi,
        registerTool(tool) {
          if (allowed.has(tool.name)) pi.registerTool(tool);
        },
      };
      browserExtension(api, async (registry, input, requestOptions) => {
        if (ledger.measuring) ledger.classifierCalls++;
        const tracked: ClassifierRegistry = {
          findOfType: registry.findOfType.bind(registry),
          async classify(model, context, opts) {
            if (ledger.measuring) ledger.classifierModels.add(`${model.provider}/${model.id}`);
            return registry.classify(model, context, opts);
          },
        };
        const result = await classify(tracked, input, {
          ...requestOptions,
          onFetchAttempt: () => {
            if (ledger.measuring) ledger.classifierAttempts++;
            requestOptions?.onFetchAttempt?.();
          },
        });
        if (ledger.measuring) addUsage(ledger.classifierUsage, result.usage);
        if (ledger.measuring && !result.ok)
          ledger.classifierFailures.push({ reason: result.reason, stage: result.stage });
        return result;
      });
    }
    pi.registerTool({
      name: HOST,
      label: "Benchmark control",
      description: "Internal benchmark setup; not exposed to the agent.",
      exposure: "deferred",
      parameters: Type.Object({
        name: Type.String(),
        args: Type.Record(Type.String(), Type.Unknown()),
      }),
      async execute(_id, params, signal, _update, ctx) {
        const result = await ctx.executeTool(params.name, params.args, { signal });
        if (result.isError) throw new Error(outputText(result.result));
        return result.result;
      },
    });
  };
  let signalReady: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    signalReady = resolve;
  });
  const resourceLoader = new sdk.DefaultResourceLoader({
    cwd: homedir(),
    agentDir: sdk.getAgentDir(),
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: BASE_PROMPT,
    extensionFactories: [
      ...(options.codemode ? [sdk.createCodemodeExtension({ mode: "only", models: false })] : []),
      async (pi) =>
        sdk.createMcpExtension({
          loadConfig: () => ({
            servers: [
              {
                name: "chrome_devtools",
                source: "browser-comparison",
                scope: "extension",
                config: {
                  command: "npm",
                  args: [
                    "exec",
                    "--offline",
                    "--yes",
                    "--cache",
                    join(homedir(), ".cache/pi/npm"),
                    "--package=chrome-devtools-mcp@1.10.1",
                    "--",
                    "chrome-devtools-mcp",
                    "--headless",
                    "--isolated",
                    "--executablePath",
                    options.executable,
                    "--no-usage-statistics",
                    "--no-performance-crux",
                    "--chromeArg=--no-sandbox",
                    "--chromeArg=--ozone-platform=headless",
                    "--logFile",
                    join(options.output, `mcp-${arm}-${Date.now()}.log`),
                  ],
                  exposure: options.codemode ? "codemode" : "deferred",
                  timeout: 30,
                },
              },
            ],
            errors: [],
            autoEnableCodemode: false,
          }),
        })({
          ...pi,
          registerTool(tool) {
            pi.registerTool(tool);
            if (CODEMODE_NATIVE_TOOLS.some((name) => tool.name === NATIVE + name))
              nativeSchemas.push({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              });
            if (tool.name === `${NATIVE}list_pages`) signalReady?.();
          },
        }),
      extension,
    ],
  });
  await resourceLoader.reload();
  const extensionErrors = resourceLoader.getExtensions().errors;
  if (extensionErrors.length) throw new Error(JSON.stringify(extensionErrors));
  const model =
    options.phase === "agent" ? runtime.getModel(options.provider, options.model) : undefined;
  if (options.phase === "agent" && !model)
    throw new Error(`Model not found: ${options.provider}/${options.model}`);
  const { session } = await sdk.createAgentSession({
    cwd: homedir(),
    agentDir: sdk.getAgentDir(),
    modelRuntime: runtime,
    resourceLoader,
    settingsManager,
    sessionManager,
    ...(model ? { model } : {}),
    thinkingLevel: options.thinking,
  });
  try {
    if (options.phase === "agent" && session.thinkingLevel !== options.thinking)
      throw new Error(
        `Requested thinking ${options.thinking}, runtime selected ${session.thinkingLevel}`,
      );
    await session.bindExtensions({
      onError: (error) => console.error(JSON.stringify({ extensionError: error })),
    });
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ready,
        new Promise<never>((_resolve, reject) => {
          readyTimer = setTimeout(
            () => reject(new Error("Chrome MCP tool registration timed out")),
            30_000,
          );
        }),
      ]);
    } finally {
      if (readyTimer !== undefined) clearTimeout(readyTimer);
    }
    session.setActiveToolsByName([HOST]);
    const host = session.agent.state.tools.find((tool) => tool.name === HOST);
    if (!host) throw new Error("Benchmark dispatcher did not bind");
    let sequence = 0;
    const execute = (name: string, args: Record<string, unknown>, signal?: AbortSignal) =>
      host.execute(`bench-${++sequence}`, { name, args }, signal);
    const call = async (name: string, args: Record<string, unknown>) =>
      outputText(await execute(name, args));
    // Warm the connected MCP server and its isolated browser before timing.
    await call(`${NATIVE}list_pages`, {});
    return { session, ledger, call, execute, nativeSchemas };
  } catch (error) {
    try {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    } finally {
      session.dispose();
    }
    throw error;
  }
}
type BrowserRuntime = Awaited<ReturnType<typeof openRuntime>>;
function pickRef(snapshot: string, label: string, wrapped: boolean): string {
  for (const line of snapshot.split("\n")) {
    if (wrapped) {
      const match = /^- (?:textbox|button|link) ("(?:\\.|[^"\\])*") \[ref=(e\d+)/u.exec(line);
      if (match?.[1] && JSON.parse(match[1]) === label && match[2]) return `@${match[2]}`;
    } else {
      const match = /^\s*uid=(\S+)\s+(?:textbox|button|link)\s+("(?:\\.|[^"\\])*")/u.exec(line);
      if (match?.[2] && JSON.parse(match[2]) === label && match[1]) return match[1];
    }
  }
  throw new Error(`No ref for ${JSON.stringify(label)}`);
}
async function scriptedWork(h: BrowserRuntime, arm: Arm, caseId: CaseId, pageId: number) {
  const wrapped = arm !== "raw";
  const snapshot = () =>
    h.call(
      wrapped ? "browser_snapshot" : `${NATIVE}take_snapshot`,
      wrapped
        ? { backend: "chrome", pageId, interactiveOnly: false, includeUrls: true }
        : { pageId },
    );
  const act = (action: "fill" | "click", target: string, value?: string) =>
    h.call(
      wrapped ? "browser_act" : `${NATIVE}${action}`,
      wrapped
        ? { backend: "chrome", pageId, action, target, ...(value === undefined ? {} : { value }) }
        : { pageId, uid: target, ...(value === undefined ? {} : { value }) },
    );
  let state = await snapshot();
  if (caseId === "observe") {
    if (!state.includes("Email") || !state.includes("Save profile"))
      throw new Error("Missing observed controls");
    return;
  }
  if (caseId === "form") {
    await act("fill", pickRef(state, "Email", wrapped), EMAIL);
    state = await snapshot();
    await act("click", pickRef(state, "Save profile", wrapped));
  } else await act("click", pickRef(state, "Open settings", wrapped));
  await snapshot();
}
function activeNames(arm: Arm): string[] {
  const consoleTool = `${NATIVE}list_console_messages`;
  if (arm === "raw")
    return ["take_snapshot", "fill", "click", "press_key", "list_console_messages"].map(
      (s) => NATIVE + s,
    );
  if (arm === "deterministic") return ["browser_snapshot", "browser_act", consoleTool];
  return ["browser_snapshot", "browser_act", "browser_step", "browser_run", consoleTool];
}
async function agentWork(
  h: BrowserRuntime,
  options: Options,
  objective: string,
  pageId: number,
  arm: Arm,
) {
  h.session.setActiveToolsByName(activeNames(arm));
  let turns = 0;
  let stopped: string | undefined;
  const unsubscribe = h.session.subscribe((event) => {
    if (event.type === "turn_end" && ++turns >= options.maxTurns) {
      stopped = "turn-limit";
      void h.session.abort();
    }
  });
  const timer = setTimeout(() => {
    stopped = "timeout";
    void h.session.abort();
  }, options.timeoutMs);
  try {
    const routing =
      arm === "orchestrated"
        ? "Prefer browser_run for the workflow or browser_step for navigation. Use at most 4 steps per browser_run. Use browser_act only if orchestration cannot express a needed action."
        : arm === "deterministic"
          ? "Use browser_snapshot and browser_act for supported operations."
          : "Use the native Chrome MCP tools.";
    await h.session.prompt(
      `${objective}\nCurrent Chrome pageId: ${pageId}. Stay on this page and use backend chrome for wrapper calls. ${routing}\nNative console diagnostics are available when required. Do not open another page.`,
    );
    const last = [...h.session.messages].reverse().find((message) => message.role === "assistant");
    if (
      last?.role === "assistant" &&
      (last.stopReason === "error" || last.stopReason === "aborted")
    )
      stopped = last.errorMessage ?? last.stopReason;
    return stopped;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}
async function sample(
  h: BrowserRuntime,
  options: Options,
  fixture: ReturnType<typeof createFixture>,
  caseId: CaseId,
  arm: Arm,
  repetition: number,
): Promise<Sample> {
  const page = fixture.create(caseId);
  let pageId: number | undefined;
  try {
    const opened = await h.call(`${NATIVE}new_page`, { url: page.url });
    const rawId = /^\s*(\d+):.*\[selected\]\s*$/mu.exec(opened)?.[1];
    if (!rawId) throw new Error("Chrome MCP did not return a page ID");
    pageId = Number(rawId);
    // Warm protocol/DOM observation equally; setup is excluded from all timed arms.
    await h.call(`${NATIVE}take_snapshot`, { pageId });
    const ledger = h.ledger;
    ledger.measuring = true;
    let failure: string | undefined;
    const start = performance.now();
    try {
      if (options.phase === "scripted") await scriptedWork(h, arm, caseId, pageId);
      else failure = await agentWork(h, options, page.objective, pageId, arm);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    const durationMs = performance.now() - start;
    ledger.measuring = false;
    // Await fixture writes, then use private server state as the independent correctness oracle.
    await h.call(`${NATIVE}evaluate_script`, {
      pageId,
      function: "async () => { await window.benchmarkPending; return true; }",
    });
    const verdict = judge(page.state());
    const primaryUsage = tokenTotals();
    let modelTurns = 0;
    for (const message of h.session.messages)
      if (message.role === "assistant" && message.provider !== "benchmark-controller") {
        modelTurns++;
        addUsage(primaryUsage, message.usage);
      }
    return {
      phase: options.phase,
      arm,
      caseId,
      repetition,
      warmup: repetition < 0,
      durationMs,
      success: verdict.success && failure === undefined,
      verdict,
      ...(failure ? { error: failure.slice(0, 1000) } : {}),
      calls: ledger.calls,
      modelTurns,
      classifierCalls: ledger.classifierCalls,
      classifierAttempts: ledger.classifierAttempts,
      classifierModels: [...ledger.classifierModels],
      primaryUsage,
      classifierUsage: ledger.classifierUsage,
      stopReasons: ledger.stopReasons,
    };
  } finally {
    if (pageId !== undefined) await h.call(`${NATIVE}close_page`, { pageId });
    page.dispose();
  }
}
async function main() {
  const options = parseOptions(process.argv.slice(2));
  await mkdir(options.output, { recursive: true });
  const fixture = createFixture();
  const samples: Sample[] = [];
  const sourceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const provenance = await Promise.all(
    SOURCE_FILES.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(join(sourceRoot, path)))
        .digest("hex"),
    })),
  );
  const metadata = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    phase: options.phase,
    runs: options.runs,
    warmups: options.warmups,
    cases: options.cases,
    model: options.phase === "agent" ? `${options.provider}/${options.model}` : null,
    thinking: options.thinking,
    backend: "Chrome MCP",
    mcpVersion: "1.10.1",
    chrome: options.executable,
    runtime: `Bun ${Bun.version}`,
    nodeCompatibility: process.version,
    sdkVersion: VERSION,
    platform: process.platform,
    architecture: process.arch,
    nativeTransport: "Pi built-in MCP extension; cached npm exec --offline",
    isolation: "New headless isolated Chrome profile per sample; no personal tabs or profile",
    timedRegion:
      "Scripted tool responses or entire agent prompt; excludes setup, verification and cleanup",
    order: "Paired, counterbalanced rotating arm order; no concurrent browser/model trials",
    cachePolicy:
      "New session/browser per sample; one untimed native snapshot before measurement. Hosted prompt caches are provider-managed and reported, not cleared.",
    provenance,
    limits: { timeoutMs: options.timeoutMs, maxTurns: options.maxTurns },
    costs:
      "Provider-reported catalog estimates, not billing receipts. Missing classifier usage is counted, never treated as free.",
    limitations: [
      "Small local-fixture sample; no production-site or Firefox claim",
      "The scripted driver uses a synthetic assistant context, excluded from provider requests and inference counts",
      "The isolated benchmark Chrome uses --no-sandbox on this Nix host; only trusted local fixtures are exercised",
      "Scripted arms follow identical explicit snapshot/action sequences, not an optimized raw-MCP policy",
      "Discovery is excluded; each arm starts with its permitted tools active",
      "Default Chrome/MCP permission pipeline is shared; no custom production permission extension is loaded",
    ],
  };
  let complete = false;
  let fatal: string | undefined;
  await writeFile(join(options.output, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
  try {
    const runtime = await ModelRuntime.create({ allowModelNetwork: false });
    const arms: Arm[] =
      options.phase === "scripted"
        ? ["raw", "deterministic"]
        : ["raw", "deterministic", "orchestrated"];
    for (let repetition = -options.warmups; repetition < options.runs; repetition++) {
      for (const [caseIndex, caseId] of options.cases.entries()) {
        for (const arm of orderedArms(arms, repetition + options.warmups + caseIndex)) {
          const h = await openRuntime(options, runtime, arm, options.phase === "scripted");
          try {
            const result = await sample(h, options, fixture, caseId, arm, repetition);
            samples.push(result);
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
            await writeFile(
              join(options.output, `trace-${caseId}-${arm}-${repetition}.json`),
              `${JSON.stringify(trace, null, 2)}\n`,
            );
            await appendFile(join(options.output, "samples.jsonl"), JSON.stringify(result) + "\n");
            console.log(
              JSON.stringify({
                caseId,
                arm,
                repetition,
                success: result.success,
                ms: Math.round(result.durationMs),
                nativeCalls: result.calls.filter((c) => c.name.startsWith(NATIVE)).length,
                turns: result.modelTurns,
                classifierCalls: result.classifierCalls,
                ...(result.error ? { error: result.error } : {}),
              }),
            );
          } finally {
            try {
              await h.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
            } finally {
              h.session.dispose();
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
    const report = { complete, ...(fatal ? { fatal } : {}), metadata, ...summarize(samples) };
    await writeFile(join(options.output, "summary.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(
      JSON.stringify({
        complete,
        samples: samples.length,
        output: options.output,
        ...(fatal ? { fatal } : {}),
      }),
    );
  }
  if (complete && samples.some((s) => !s.warmup && !s.success)) process.exitCode = 2;
}
if (import.meta.main) await main();
