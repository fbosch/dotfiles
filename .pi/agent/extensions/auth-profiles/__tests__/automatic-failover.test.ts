import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage, type CredentialStore } from "@earendil-works/pi-ai";
import {
  type AgentBeforeSettleEvent,
  type BoundaryResult,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionEvent,
  SessionManager,
  type TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import authProfiles from "../index";
import type { ProfileSelection } from "../profile-selector";
import { authPathFor } from "../profile-store";
import { createCredentialStore, createOpenAiCodexProfileAdapter } from "../providers/openai-codex";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const directories: string[] = [];
afterEach(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

const codexLimit = "Codex error: The usage limit has been reached";
const anthropicLimit =
  '429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit."}}';

function response(provider: string, errorMessage?: string): AssistantMessage {
  return {
    role: "assistant",
    api: provider === "anthropic" ? "anthropic-messages" : "openai-codex-responses",
    provider,
    model: "fixture",
    content: errorMessage === undefined ? [{ type: "text", text: "Done" }] : [],
    stopReason: errorMessage === undefined ? "stop" : "error",
    ...(errorMessage === undefined ? {} : { errorMessage }),
    timestamp: 1_000_000,
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

async function fixture(provider = "openai-codex", available = ["fbb", "jpb", "ct"]) {
  const root = await mkdtemp(join(tmpdir(), "pi-auto-failover-"));
  directories.push(root);
  await mkdir(join(root, "auth-profiles"));
  process.env.PI_CODING_AGENT_DIR = root;
  for (const profile of ["fbb", "jpb", "ct"]) {
    await writeFile(authPathFor(profile, root), JSON.stringify({
      "openai-codex": { type: "api_key", key: `codex-${profile}` },
      anthropic: { type: "oauth", access: profile, refresh: profile, expires: 9_999_999_999_999 },
    }));
  }
  const handlers = new Map<string, Array<(event: never, ctx: ExtensionContext) => unknown>>();
  const pi = {
    on(event: string, handler: (event: never, ctx: ExtensionContext) => unknown) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand() {},
    exec: async () => ({ code: 1, stdout: "", stderr: "", killed: false }),
  } as unknown as ExtensionAPI;
  let currentTime = 1_000_000;
  const baseSelection: ProfileSelection = {
    profile: "fbb", profileOrder: ["fbb", "jpb", "ct", "default"],
    source: "host default", host: { name: "fixture", source: "system hostname" },
    hostPreferences: ["fbb", "jpb", "ct"], repositoryPreferences: [],
    fallbackReason: "confirmed usage",
  };
  const extension = (pi: ExtensionAPI) => authProfiles(pi, {
    now: () => currentTime,
    providerAdapter: {
      ...createOpenAiCodexProfileAdapter(root),
      createCredentialStore: (profile) => createCredentialStore(authPathFor(profile, root)),
    },
    selectProfile: async (_ctx, options) => {
      if (options?.excludedProfiles === undefined) return baseSelection;
      const next = baseSelection.profileOrder.find(
        (profile) => available.includes(profile) && !options.excludedProfiles?.has(profile),
      );
      return next === undefined
        ? { ...baseSelection, fallbackReason: "credential availability" }
        : { ...baseSelection, profile: next };
    },
    usageCollector: async () => ({
      schema: "fbb.pi-auth-profiles-usage/v1", diagnostics: [],
      profiles: ["fbb", "jpb", "ct"].map((profileLabel) => ({
        profileLabel, active: profileLabel === "fbb", urgency: "unknown",
        usage: [], anthropicUsage: [{ windowId: "primary", remaining: available.includes(profileLabel) ? 50 : 0 }],
      })),
    }),
  });
  extension(pi);
  const manager = SessionManager.inMemory(root);
  manager.appendMessage({ role: "user", content: "Complete the task", timestamp: currentTime });
  const completed = response(provider);
  completed.content = [{ type: "toolCall", id: "completed-tool", name: "write", arguments: { path: "done" } }];
  completed.stopReason = "toolUse";
  manager.appendMessage(completed);
  manager.appendMessage({ role: "toolResult", toolCallId: "completed-tool", toolName: "write", content: [{ type: "text", text: "Already written" }], isError: false, timestamp: currentTime });
  const store = await createCredentialStore(authPathFor("fbb", root));
  const runtime = {
    login: async () => { throw new Error("Unexpected login"); },
    credentials: { store: store as CredentialStore },
  };
  const notifications: string[] = [];
  const ctx = {
    cwd: root, isProjectTrusted: () => false, mode: "tui", model: { provider },
    modelRegistry: { runtime, refresh: async () => undefined }, sessionManager: manager,
    ui: { notify: (message: string) => notifications.push(message), setStatus() {} },
  } as unknown as ExtensionContext;
  async function emit(event: ExtensionEvent) {
    const results: unknown[] = [];
    for (const handler of handlers.get(event.type) ?? []) results.push(await handler(event as never, ctx));
    return results;
  }
  await emit({ type: "session_start", reason: "startup" });
  const preview = () => ({
    contextEntries: manager.buildSessionProjection().entries,
    contextMessages: manager.buildSessionContext().messages,
    llmMessages: [], pendingMessages: [], canContinue: false,
  });
  async function finish(message: AssistantMessage, outcome: TurnEndEvent["outcome"] = "error") {
    await emit({ type: "message_end", message });
    const messageEntryId = manager.appendMessage(message);
    await emit({ type: "turn_end", message, messageEntryId, turnIndex: 0, toolResults: [], toolResultEntryIds: [], entries: [], continue: false, outcome, context: preview() });
    return messageEntryId;
  }
  async function settle(outcome: AgentBeforeSettleEvent["outcome"] = "error") {
    const results = await emit({ type: "agent_before_settle", entries: [], continue: false, outcome, context: preview() });
    return results.find((value) => value !== undefined) as BoundaryResult | undefined;
  }
  return {
    emit, finish, settle, manager, notifications, extension, root,
    startRequest: () => emit({ type: "before_provider_headers", headers: {} }),
    headersLimit: (status = 429) => emit({ type: "after_provider_response", status, headers: { "x-codex-primary-used-percent": "100", "x-codex-primary-reset-after-seconds": "60" } }),
    credential: () => runtime.credentials.store.read(provider),
    advance: (ms: number) => { currentTime += ms; },
  };
}

for (const provider of ["openai-codex", "anthropic"]) {
  test(`${provider} resumes with successive credentials without replaying completed tools`, async () => {
    const f = await fixture(provider);
    const initialContext = f.manager.buildSessionContext().messages;
    for (const owner of ["jpb", "ct"]) {
      await f.startRequest();
      const failedId = await f.finish(response(provider, provider === "anthropic" ? anthropicLimit : codexLimit));
      const retry = await f.settle();
      expect(retry).toEqual({ entries: [{ type: "context_edit", targetId: failedId, replacement: null }], continue: true });
      const credential = await f.credential();
      expect(credential?.type === "api_key" ? credential.key : credential?.type === "oauth" ? credential.access : undefined).toBe(provider === "anthropic" ? owner : `codex-${owner}`);
      for (const entry of retry?.entries ?? []) {
        if (entry.type === "context_edit") f.manager.appendContextEdit(entry.targetId, entry.replacement);
      }
      expect(f.manager.buildSessionContext().messages).toEqual(initialContext);
      expect(await f.settle()).toBeUndefined();
    }
    await f.startRequest();
    await f.finish(response(provider, provider === "anthropic" ? anthropicLimit : codexLimit));
    expect(await f.settle()).toBeUndefined();
    expect(f.notifications.at(-1)).toContain("no alternate profile has confirmed available");
  });

  test(`${provider} stops when no alternate quota is confirmed`, async () => {
    const f = await fixture(provider, ["fbb"]);
    await f.startRequest();
    await f.finish(response(provider, provider === "anthropic" ? anthropicLimit : codexLimit));
    expect(await f.settle()).toBeUndefined();
  });
}

test("Codex header-only limits resume even when the error body is unrecognized", async () => {
  const f = await fixture();
  await f.startRequest();
  await f.headersLimit();
  await f.finish(response("openai-codex", "429 unknown body"));
  expect(await f.settle()).toMatchObject({ continue: true });
});

test("successful exhausted responses rotate without retrying", async () => {
  const f = await fixture();
  await f.startRequest();
  await f.headersLimit(200);
  await f.finish(response("openai-codex"), "completed");
  expect(await f.settle("completed")).toBeUndefined();
  expect(await f.credential()).toMatchObject({ type: "api_key", key: "codex-jpb" });
});

test("unrelated failures do not continue", async () => {
  const f = await fixture();
  await f.startRequest();
  await f.finish(response("openai-codex", "network connection failed"));
  expect(await f.settle()).toBeUndefined();
});

test("cancellation and shutdown discard pending quota retries", async () => {
  for (const shutdown of [false, true]) {
    const f = await fixture();
    await f.startRequest();
    await f.finish(response("openai-codex", codexLimit));
    if (shutdown) await f.emit({ type: "session_shutdown", reason: "quit" });
    expect(await f.settle(shutdown ? "error" : "aborted")).toBeUndefined();
  }
});

test("an already-started runtime retry consumes the pending failure", async () => {
  const f = await fixture();
  await f.startRequest();
  await f.finish(response("openai-codex", codexLimit));
  await f.startRequest();
  expect(await f.settle()).toBeUndefined();
});

test("quota resets cannot loop back to a previously attempted owner", async () => {
  const f = await fixture();
  await f.startRequest();
  await f.finish(response("openai-codex", codexLimit));
  expect(await f.settle()).toMatchObject({ continue: true });
  await f.startRequest();
  f.advance(61_000);
  await f.finish(response("openai-codex", codexLimit));
  expect(await f.settle()).toBeUndefined();
});


test("installed Pi automatically completes the original prompt after quota failover", async () => {
  const f = await fixture();
  const sdk = await import("@earendil-works/pi-coding-agent");
  const settingsManager = sdk.SettingsManager.inMemory({ cacheWarming: "off", retry: { enabled: false } });
  const modelRuntime = await sdk.ModelRuntime.create({
    authPath: authPathFor("fbb", f.root), modelsPath: join(f.root, "models.json"),
    modelsStorePath: join(f.root, "catalog.json"), refreshOnCreate: false, allowModelNetwork: false,
  });
  // Native Codex accepts OAuth only; use a synthetic provider for fixture API keys.
  modelRuntime.registerNativeProvider({
    id: "openai-codex", name: "Fixture Codex", getModels: () => [],
    auth: { apiKey: { name: "Fixture key", resolve: async ({ credential }) =>
      credential?.key === undefined ? undefined : { auth: { apiKey: credential.key } },
    } },
    stream: () => { throw new Error("Unexpected network request"); },
    streamSimple: () => { throw new Error("Unexpected network request"); },
  });
  const loader = new sdk.DefaultResourceLoader({
    cwd: f.root, agentDir: f.root, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [f.extension],
  });
  await loader.reload();
  expect(loader.getExtensions().errors).toEqual([]);
  const { session } = await sdk.createAgentSession({
    cwd: f.root, agentDir: f.root, modelRuntime, resourceLoader: loader, settingsManager,
    sessionManager: sdk.SessionManager.inMemory(f.root), tools: [],
    model: {
      id: "fixture", name: "fixture", provider: "openai-codex", api: "openai-codex-responses",
      baseUrl: "https://example.invalid", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1000,
    },
  });
  const errors: string[] = [];
  try {
    await session.bindExtensions({ onError: (error) => errors.push(error.error) });
    const credentials: Array<string | undefined> = [];
    session.agent.streamFunction = async () => {
      // Replace HTTP streaming, retaining the runtime's header and auth resolution.
      await session.extensionRunner.emitBeforeProviderHeaders({});
      credentials.push((await modelRuntime.getAuth("openai-codex"))?.auth.apiKey);
      const message = response("openai-codex", credentials.length === 1 ? codexLimit : undefined);
      const stream = createAssistantMessageEventStream();
      if (message.stopReason === "error") stream.push({ type: "error", reason: "error", error: message });
      else stream.push({ type: "done", reason: "stop", message });
      stream.end();
      return stream;
    };
    await session.prompt("Finish this original task");
    expect(errors).toEqual([]);
    expect(credentials).toEqual(["codex-fbb", "codex-jpb"]);
    const context = session.sessionManager.buildSessionContext().messages;
    expect(context.filter((message) => message.role === "user")).toHaveLength(1);
    expect(context.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Done" }] });
  } finally {
    await session.abort();
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  }
});
