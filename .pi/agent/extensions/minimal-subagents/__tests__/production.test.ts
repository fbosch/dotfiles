import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentSession, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createProductionExtension, requestSubagentLaunch } from "../production";
import type { ChildDriver, ChildExecutionOutcome, ChildRunInput } from "../owner";
import type { PiChildDriver } from "../driver";

const sdk: typeof import("@earendil-works/pi-coding-agent") = await import(
  process.env.PI_SUBAGENT_TEST_SDK ?? "@earendil-works/pi-coding-agent"
);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const baselineFiles = [
  "extensions/auth-profiles/index.ts",
  "extensions/model-presets.ts",
  "extensions/openai-capabilities.ts",
  "extensions/classifier-policy/index.ts",
  "extensions/catastrophic-command-guard.ts",
  "extensions/semantic-command-guard/index.ts",
  "extensions/instruction-fragments.ts",
] as const;
const hashline = "npm/node_modules/pi-hashline-edit-pro/index.ts";

type ModelResolver = ConstructorParameters<typeof PiChildDriver>[0]["resolveModel"];

function controlledDriver() {
  const starts: ChildRunInput[] = [];
  const resolvedModels: Array<ReturnType<ModelResolver>> = [];
  const finishers = new Map<string, (outcome: ChildExecutionOutcome) => void>();
  let resolveModel: ModelResolver | undefined;
  let signalStarted = () => {};
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const finish = (workerId: string) => {
    finishers.get(workerId)?.({ kind: "failed", turnsUsed: 0, error: "Fixture stopped" });
  };
  const driver: ChildDriver & Pick<PiChildDriver, "observation"> = {
    start(input) {
      starts.push(input);
      resolvedModels.push(resolveModel?.(input.config));
      signalStarted();
      return new Promise((resolve) => { finishers.set(input.workerId, resolve); });
    },
    prompt(input, callbacks) { return this.start(input, callbacks); },
    async steer() {},
    async abort(workerId) { finish(workerId); },
    async close(workerId) {
      finish(workerId);
      return { confirmed: true };
    },
    observation() { return undefined; },
  };
  return { driver, starts, resolvedModels, started, setResolveModel(value: ModelResolver) { resolveModel = value; } };
}

async function fixture(options: { model?: string; missingPolicy?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-minimal-subagents-production-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  for (const path of [...baselineFiles, hashline]) {
    if (path === options.missingPolicy) continue;
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, "export default function () {}\n");
  }
  await mkdir(join(root, "agents"), { recursive: true });
  await writeFile(join(root, "agents", "fixture.md"), `---
description: Fixture role
model: ${options.model ?? "fixture/fixture"}
max_turns: 12
tools: [read]
bundles: [files]
skills: []
---
Inspect the assignment and return evidence.
`);

  const settingsManager = sdk.SettingsManager.inMemory({ cacheWarming: "off" });
  const modelRuntime = await sdk.ModelRuntime.create({
    authPath: join(root, "auth.json"),
    modelsPath: join(root, "models.json"),
    modelsStorePath: join(root, "models-store.json"),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const controlled = controlledDriver();
  let events: ExtensionAPI["events"] | undefined;
  const registerFixtureProvider: ExtensionFactory = (pi) => {
    pi.registerProvider("fixture", {
      api: "openai-completions",
      baseUrl: "https://fixture.invalid",
      apiKey: "fixture-only",
      models: [{
        id: "fixture",
        name: "Fixture",
        input: ["text"],
        reasoning: false,
        contextWindow: 32_000,
        maxTokens: 1_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }],
    });
  };
  const subagents: ExtensionFactory = (pi) => {
    events = pi.events;
    createProductionExtension({ agentDir: root }, {
      createDriver: (driverOptions) => {
        controlled.setResolveModel(driverOptions.resolveModel);
        return controlled.driver;
      },
    })(pi);
  };
  const loader = new sdk.DefaultResourceLoader({
    cwd: root,
    agentDir: root,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [registerFixtureProvider, subagents],
  });
  await loader.reload();
  expect(loader.getExtensions().errors).toEqual([]);
  const { session } = await sdk.createAgentSession({
    cwd: root,
    agentDir: root,
    settingsManager,
    modelRuntime,
    resourceLoader: loader,
    sessionManager: sdk.SessionManager.inMemory(root),
    tools: ["subagent", "subagent_result", "subagent_control"],
    excludeTools: ["mcp__*"],
  });
  cleanups.push(async () => {
    await session.abort();
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  });
  const errors: string[] = [];
  await session.bindExtensions({ onError: (error) => { errors.push(error.error); } });
  expect(errors).toEqual([]);
  if (!events) throw new Error("Production event bus was not captured");
  return { root, session, events, controlled };
}

function tool(session: AgentSession, name: string) {
  const registered = session.agent.state.tools.find((candidate) => candidate.name === name);
  if (!registered) throw new Error(`Missing tool: ${name}`);
  return registered;
}

test("production launch requests share the native runtime and resolve configured models and capabilities", async () => {
  const f = await fixture();
  const launch = await requestSubagentLaunch(f.events, { specialist: "fixture", prompt: "Check the files" });
  expect(launch.kind).toBe("launched");
  if (launch.kind !== "launched") throw new Error("Expected a background launch");
  await f.controlled.started;

  const input = f.controlled.starts[0];
  expect(input?.config.model).toBe("fixture/fixture");
  expect(input?.config.maxTurns).toBe(12);
  expect(input?.config.tools).toEqual(["read", "codemode"]);
  expect(input?.config.skills).toEqual([]);
  expect(input?.config.extensions).toEqual([
    ...baselineFiles.map((path) => join(f.root, path)),
    join(f.root, hashline),
  ]);
  expect(f.controlled.resolvedModels[0]).toMatchObject({ provider: "fixture", id: "fixture" });

  const status = await tool(f.session, "subagent_result").execute(
    "fixture-status",
    { request: { mode: "status", workerId: launch.workerId } },
    new AbortController().signal,
  );
  expect(JSON.stringify(status.content)).toContain(launch.workerId);
});

test("production preflight rejects unavailable models and missing mandatory policy files before launch", async () => {
  const unavailable = await fixture({ model: "fixture/not-configured" });
  await expect(requestSubagentLaunch(unavailable.events, { specialist: "fixture", prompt: "Must not start" }))
    .rejects.toThrow("Required model is unavailable: fixture/not-configured");
  expect(unavailable.controlled.starts).toEqual([]);

  const missingPolicy = baselineFiles[3];
  const missing = await fixture({ missingPolicy });
  await expect(requestSubagentLaunch(missing.events, { specialist: "fixture", prompt: "Must not start" }))
    .rejects.toThrow("Required capability file is unavailable");
  expect(missing.controlled.starts).toEqual([]);
});

test("native launch requests fail immediately when the production bridge is absent", async () => {
  const noListener: ExtensionAPI["events"] = {
    emit() {},
    on() { return () => {}; },
  };
  await expect(requestSubagentLaunch(noListener, { specialist: "fixture", prompt: "Task" }))
    .rejects.toThrow("Minimal subagents launch handler is unavailable");
});

test("production specialist definitions resolve explicit capabilities and preserve read-only roles", async () => {
  const { resolve } = await import("node:path");
  const { readdir } = await import("node:fs/promises");
  const { resolveNamedSpecialist } = await import("../catalog");
  const { MODEL_PRESETS } = await import("../../model-presets");
  const agentDir = resolve(import.meta.dir, "../../..");
  const availableModels = new Set(Object.keys(MODEL_PRESETS).map((name) => `presets/${name}`));
  const definitions = (await readdir(join(agentDir, "agents"))).filter((name) => name.endsWith(".md"));
  for (const file of definitions) {
    const name = file.slice(0, -3);
    const config = await resolveNamedSpecialist({ name, agentDir, cwd: resolve(agentDir, "../.."), projectTrusted: true, availableModels });
    expect(config.name).toBe(name);
    expect(config.maxTurns).toBeGreaterThan(0);
    expect(config.tools.length).toBeGreaterThan(0);
    if (["explore", "analyze", "patterns", "backlog-planning", "review", "spec", "research"].includes(name)) {
      for (const tool of ["bash", "write", "replace", "insert"]) expect(config.tools).not.toContain(tool);
    }
  }
  expect(definitions.length).toBe(20);
});
