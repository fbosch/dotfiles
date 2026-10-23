import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as Pi from "@earendil-works/pi-coding-agent";
import type { BudgetAdviceInput, BudgetSnapshot } from "../extensions/subagents/budget";
import { createBudgetAdvisor } from "../extensions/subagents/budget-advisor";
import { resolveNamedSpecialist } from "../extensions/subagents/catalog";
import { createChildSession } from "../extensions/subagents/child-session";
import { PiChildDriver } from "../extensions/subagents/driver";
import {
  type AssignmentOutcome,
  type ChildDriver,
  type ChildDriverCallbacks,
  type ChildRunInput,
  WorkerOwner,
} from "../extensions/subagents/owner";
import type { ClassifierOptions } from "../lib/classifier";
import { visibleAssistantTexts } from "./subagent-budget-fixtures";

export type PilotArm = "fixed" | "advisory" | "reference";
export interface TrialCheckpoint {
  readonly budget: BudgetSnapshot;
  readonly visibleTexts: readonly string[];
}
export interface BudgetTrialOptions {
  readonly sdkRoot: string;
  readonly cwd: string;
  readonly directory: string;
  readonly prompt: string;
  readonly arm: PilotArm;
  readonly timeoutMs: number;
}
export interface BudgetTrialResult {
  readonly outcome: AssignmentOutcome;
  readonly turnsUsed: number;
  readonly checkpoint?: TrialCheckpoint;
  readonly visibleTexts: readonly string[];
  readonly waitingForParent: boolean;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly manualTurns: number;
  readonly cleanupConfirmed: boolean;
  readonly storageFailed: boolean;
  readonly workerSdkRequests: number;
  readonly workerObservedFetches: number;
  readonly classifierProviderDispatches: number;
  readonly classifierObservedFetches: number;
  readonly physicalModels: readonly string[];
  readonly adviceInputs: readonly BudgetAdviceInput[];
  readonly budget: BudgetSnapshot;
  readonly workerUsage: {
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly reportedCost: number | null;
  };
  readonly violations: readonly string[];
}

const retainedUncertainResources: unknown[] = [];

async function loadSdk(root: string): Promise<typeof Pi> {
  const sdk: typeof Pi = await import(pathToFileURL(join(root, "dist/index.js")).href);
  if (sdk.VERSION !== "1.3.0") throw new Error("The pilot requires installed Pi 1.3.0");
  return sdk;
}

/** One private SDK/owner lifetime; advice never receives reports or fixture content. */
export async function runBudgetTrial(options: BudgetTrialOptions): Promise<BudgetTrialResult> {
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 120_000
  )
    throw new Error("Invalid pilot trial timeout");
  const sdk = await loadSdk(options.sdkRoot);
  const agentDir = sdk.getAgentDir();
  const globalSettings = sdk.SettingsManager.create(options.cwd, agentDir, {
    projectTrusted: false,
  }).getSettings();
  const settingsManager = sdk.SettingsManager.inMemory({
    ...globalSettings,
    packages: [],
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
    cacheWarming: "off",
  });
  let context: Pi.ExtensionContext | undefined;
  const loader = new sdk.DefaultResourceLoader({
    cwd: options.cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: [
      "auth-profiles/index.ts",
      "model-presets.ts",
      "openai-capabilities.ts",
      "classifier-policy/index.ts",
    ].map((path) => join(agentDir, "extensions", path)),
    extensionFactories: [
      (pi) => {
        pi.on("session_start", (_event, ctx) => {
          context = ctx;
        });
      },
    ],
  });
  await loader.reload();
  if (loader.getExtensions().errors.length)
    throw new Error("Pilot parent extensions failed to load");
  const runtime = await sdk.ModelRuntime.create({ allowModelNetwork: false });
  let classifierProviderDispatches = 0;
  const classify = runtime.classify.bind(runtime);
  runtime.classify = (...args) => {
    classifierProviderDispatches++;
    return classify(...args);
  };
  const created = await sdk.createAgentSession({
    cwd: options.cwd,
    agentDir,
    settingsManager,
    modelRuntime: runtime,
    resourceLoader: loader,
    sessionManager: sdk.SessionManager.inMemory(options.cwd),
    tools: [],
    excludeTools: ["mcp__*"],
  });
  const parent = created.session;
  let owner: WorkerOwner | undefined;
  let child: Pi.AgentSession | undefined;
  let cleanupUncertain = false;
  let storageFailed = false;
  let workerSdkRequests = 0;
  let workerObservedFetches = 0;
  let classifierObservedFetches = 0;
  let manualTurns = 0;
  let checkpoint: TrialCheckpoint | undefined;
  const adviceInputs: BudgetAdviceInput[] = [];
  const physicalModels = new Set<string>();
  const violations: string[] = [];
  let result: BudgetTrialResult | undefined;
  const failures: unknown[] = [];
  try {
    const errors: string[] = [];
    await parent.bindExtensions({
      onError: (error) => {
        errors.push(error.error);
      },
    });
    const ctx = context;
    if (!ctx || errors.length) throw new Error("Pilot auth-profile initialization failed");
    const availableModels = new Set(
      ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`),
    );
    const resolved = await resolveNamedSpecialist({
      name: "test",
      cwd: options.cwd,
      agentDir,
      projectTrusted: false,
      availableModels,
      overrides: { maxTurns: 4 },
    });
    // Temporary read-only fixture bounds are not edits or recommendations for production roles.
    const config = Object.freeze({
      ...resolved,
      maxTurns: 4,
      hardMaxTurns: 8,
      skills: [],
      tools: ["read", "grep", "codemode"],
      excludeTools: [
        ...resolved.excludeTools,
        "bash",
        "write",
        "replace",
        "replace_match",
        "insert",
        "copy",
        "move",
        "undo_last_change",
      ],
    });
    const childSdk: typeof Pi = {
      ...sdk,
      ModelRuntime: new Proxy(sdk.ModelRuntime, {
        get(target, key, receiver) {
          if (key !== "create") return Reflect.get(target, key, receiver);
          return async (...args: Parameters<typeof sdk.ModelRuntime.create>) => {
            const childRuntime = await sdk.ModelRuntime.create(...args);
            const stream = childRuntime.streamSimple.bind(childRuntime);
            childRuntime.streamSimple = (model, messages, streamOptions) => {
              if (model.api === "pi-virtual") return stream(model, messages, streamOptions);
              workerSdkRequests++;
              physicalModels.add(`${model.provider}/${model.id}`);
              const transport = streamOptions?.fetch ?? globalThis.fetch;
              const fetch = new Proxy(transport, {
                apply(target, thisArgument, argumentsList) {
                  workerObservedFetches++;
                  return Reflect.apply(target, thisArgument, argumentsList);
                },
              });
              return stream(model, messages, { ...streamOptions, fetch });
            };
            return childRuntime;
          };
        },
      }),
    };
    const driver = new PiChildDriver({
      cwd: options.cwd,
      agentDir,
      projectTrusted: false,
      shutdownGraceMs: 5_000,
      resolveModel: (selected) =>
        ctx.modelRegistry
          .getAvailable()
          .find((model) => `${model.provider}/${model.id}` === selected.model),
      retainUncertain: (_id, resources) => {
        cleanupUncertain = true;
        retainedUncertainResources.push(...resources);
      },
      create: async (input) => {
        const handle = await createChildSession({ ...input, sdk: childSdk });
        child = handle.session;
        return handle;
      },
    });
    const wrap = (input: ChildRunInput, callbacks: ChildDriverCallbacks): ChildDriverCallbacks => {
      const beforeModel = callbacks.onBeforeModel;
      if (!beforeModel) throw new Error("Pilot admission callback is unavailable");
      let used = input.turnsAlreadyUsed;
      return {
        ...callbacks,
        onTurn(turns) {
          used = turns;
          callbacks.onTurn(turns);
        },
        async onBeforeModel() {
          const activeOwner = owner;
          if (!activeOwner) throw new Error("Pilot owner is unavailable");
          const target = used === 2 && checkpoint === undefined;
          if (target) {
            const assignment = activeOwner
              .inspect(input.workerId)
              .assignments.find((item) => item.id === input.assignmentId);
            if (!assignment?.budget) throw new Error("Pilot checkpoint budget is unavailable");
            checkpoint = {
              budget: assignment.budget,
              visibleTexts: visibleAssistantTexts(child?.agent.state.messages ?? []),
            };
          }
          const admission = await beforeModel();
          if (target && options.arm === "reference" && admission.admitted) {
            const state = activeOwner.inspect(input.workerId);
            const assignment = state.assignments.find((item) => item.id === input.assignmentId);
            if (state.pendingQuestion || assignment?.budget?.grantedTurns !== 4)
              throw new Error("Manual reference extension is not eligible");
            await activeOwner.extendBudget(input.workerId, input.assignmentId, 4);
            manualTurns = 4;
            return beforeModel();
          }
          return admission;
        },
      };
    };
    const observedDriver: ChildDriver = {
      start: (input, callbacks) => driver.start(input, wrap(input, callbacks)),
      prompt: (input, callbacks) => driver.prompt(input, wrap(input, callbacks)),
      steer: (id, text) => driver.steer(id, text),
      abort: (id) => driver.abort(id),
      close: (id) => driver.close(id),
    };
    const fetch: NonNullable<ClassifierOptions["fetch"]> = async (url, init) => {
      classifierObservedFetches++;
      return globalThis.fetch(url, init);
    };
    const advise = createBudgetAdvisor(ctx.modelRegistry, {
      agentDirectory: agentDir,
      settingsContext: ctx,
      fetch,
    });
    owner = new WorkerOwner({
      parentSessionId: parent.sessionManager.getSessionId(),
      driver: observedDriver,
      persistence: {
        async save(evidence) {
          try {
            await writeFile(join(options.directory, "evidence.json"), JSON.stringify(evidence), {
              mode: 0o600,
            });
          } catch (error) {
            storageFailed = true;
            throw error;
          }
        },
      },
      budget: {
        mode: options.arm === "fixed" ? "fixed" : "advisory",
        advisor: async (input, signal) => {
          adviceInputs.push(input);
          return advise(input, signal);
        },
      },
      cleanupHealth: {
        isBlocked: () => cleanupUncertain,
        markUncertain() {
          cleanupUncertain = true;
        },
      },
    });
    const started = performance.now();
    const launch = await owner.launch({ config, prompt: options.prompt, maxTurns: 4 });
    const waited = await owner.wait(launch.workerId, launch.assignmentId, {
      timeoutMs: options.timeoutMs,
    });
    const timedOut = waited.kind === "timeout";
    if (timedOut) await owner.cancel(launch.workerId);
    const durationMs = performance.now() - started;
    const handoff = owner.inspect(launch.workerId);
    const assignment = handoff.assignments.find((item) => item.id === launch.assignmentId);
    if (!assignment?.budget) throw new Error("Pilot final budget is unavailable");
    const observation = driver.observation(launch.workerId);
    const texts = visibleAssistantTexts(child?.agent.state.messages ?? []);
    const raw = JSON.stringify(
      {
        handoff,
        sessionEntries: child?.sessionManager.getEntries(),
        messages: child?.agent.state.messages,
      },
      null,
      2,
    );
    await owner.shutdown();
    if (assignment.budget.grantedTurns > 8 || assignment.turnsUsed > assignment.budget.grantedTurns)
      violations.push("turn-limit");
    if (assignment.budget.automaticGrants !== 0)
      violations.push("automatic-grant-in-nonautomatic-arm");
    if (assignment.budget.checks > 2) violations.push("check-limit");
    if (options.arm === "fixed" && adviceInputs.length !== 0)
      violations.push("fixed-arm-classification");
    if (options.arm !== "reference" && manualTurns !== 0)
      violations.push("unexpected-manual-extension");
    const cleanupConfirmed =
      !cleanupUncertain && !owner.list().some((worker) => worker.status === "cleanup-unknown");
    await writeFile(join(options.directory, "session.json"), raw, { mode: 0o600, flag: "wx" });
    result = {
      outcome: assignment.outcome,
      turnsUsed: assignment.turnsUsed,
      ...(checkpoint === undefined ? {} : { checkpoint }),
      visibleTexts: texts,
      waitingForParent: handoff.pendingQuestion !== undefined,
      durationMs,
      timedOut,
      manualTurns,
      cleanupConfirmed,
      storageFailed,
      workerSdkRequests,
      workerObservedFetches,
      classifierProviderDispatches,
      classifierObservedFetches,
      physicalModels: [...physicalModels],
      adviceInputs,
      budget: assignment.budget,
      violations,
      workerUsage: {
        inputTokens: observation?.inputTokens ?? null,
        outputTokens: observation?.outputTokens ?? null,
        reportedCost: observation?.cost ?? null,
      },
    };
  } catch (error) {
    failures.push(error);
  }
  // Attempt every cleanup and preserve execution errors alongside cleanup failures.
  for (const action of [
    () => owner?.shutdown(),
    () => parent.abort(),
    () => parent.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }),
    () => parent.dispose(),
  ]) {
    try {
      await action();
    } catch (error) {
      if (!failures.includes(error)) failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, "Pilot execution or cleanup failed");
  if (!result) throw new Error("Pilot did not produce a result");
  return result;
}
