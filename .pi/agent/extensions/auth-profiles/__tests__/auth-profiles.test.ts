import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CredentialStore } from "@earendil-works/pi-ai";
import {
  createEventBus,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import {
  createStartupOwnerRequest,
  readStartupOwnerSnapshot,
  STARTUP_OWNER_REQUEST_EVENT,
  STARTUP_OWNER_SNAPSHOT_EVENT,
  type StartupOwnerSnapshot,
} from "../../startup-header/contracts";
import authProfiles from "../index";
import type { ProfileSelection } from "../profile-selector";
import { accountIdFor, authPathFor } from "../profile-store";
import type { ProfileProviderAdapter } from "../provider-adapter";
import { createCredentialStore, createOpenAiCodexProfileAdapter } from "../providers/openai-codex";
import {
  AUTH_USAGE_OBSERVATION,
  type CollectUsageStatusOptions,
  type UsageStatusPayload,
} from "../usage-status-service";

type SessionStartHandler = (event: unknown, ctx: ExtensionContext) => Promise<void>;
type BeforeModelAvailabilityHandler = (event: unknown, ctx: ExtensionContext) => Promise<void>;
type ProviderResponseHandler = (
  event: { headers: Record<string, string>; status: number },
  ctx: ExtensionContext,
) => Promise<void>;
type ProviderHeadersHandler = (event: unknown, ctx: ExtensionContext) => Promise<void>;
type ProfileCommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

type ResetCreditCommandHandler = ProfileCommandHandler;

type InlineQuestionFactory = (
  tui: { requestRender(): void },
  theme: { fg(color: string, text: string): string },
  keybindings: {
    matches(data: string, binding: string): boolean;
    getKeys(binding: string): string[];
  },
  done: (value: unknown) => void,
) => Component;

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }

  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

class FakeAuthStore implements CredentialStore {
  static create(path?: string): FakeAuthStore {
    return new FakeAuthStore(path);
  }

  constructor(readonly path?: string) {}

  async read() {
    return undefined;
  }

  async list() {
    return [];
  }

  async modify() {
    return undefined;
  }

  async delete() {}
}

function testProviderAdapter(agentDir: string): ProfileProviderAdapter {
  const codex = createOpenAiCodexProfileAdapter(agentDir);
  return {
    ...codex,
    async createCredentialStore(profileLabel) {
      return FakeAuthStore.create(authPathFor(profileLabel, agentDir));
    },
    async readCredential(profileLabel) {
      const identity = accountIdFor(profileLabel, agentDir);
      return identity === undefined
        ? { kind: "missing" }
        : {
            kind: "valid",
            credential: {
              accessToken: "test-access",
              expiresAt: Number.MAX_SAFE_INTEGER,
              identity,
            },
          };
    },
    async resolveCredential(profileLabel) {
      const identity = accountIdFor(profileLabel, agentDir);
      if (identity === undefined) throw new Error("missing test credential");
      return { accessToken: "test-access", expiresAt: Number.MAX_SAFE_INTEGER, identity };
    },
    async refreshCredential() {
      throw new Error("unexpected credential refresh");
    },
  };
}

describe("auth profile prompt status", () => {
  test("publishes the active profile on startup and after switching", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-auth-profiles-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    const projectDir = join(root, "project");
    await mkdir(agentDir);
    await mkdir(projectDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;

    let sessionStart: SessionStartHandler | undefined;
    let sessionShutdown: SessionStartHandler | undefined;
    let profileCommand: ProfileCommandHandler | undefined;
    let resetCreditCommand: ResetCreditCommandHandler | undefined;
    let activeSessionId = "session-1";
    const sessionEntries: Array<{ type: "custom"; customType: string; data: unknown }> = [];
    const pi = {
      appendEntry(customType: string, data: unknown) {
        sessionEntries.push({ type: "custom", customType, data });
      },
      exec: async () => ({ code: 1, killed: false, stderr: "", stdout: "" }),
      on(event: string, handler: SessionStartHandler) {
        if (event === "session_start") sessionStart = handler;
        if (event === "session_shutdown") sessionShutdown = handler;
      },
      registerCommand(name: string, command: { handler: ProfileCommandHandler }) {
        if (name === "profile") profileCommand = command.handler;
        if (name === "reset-credit") resetCreditCommand = command.handler;
      },
    } as unknown as ExtensionAPI;
    let startupUsageCalls = 0;
    authProfiles(pi, {
      providerAdapter: testProviderAdapter(agentDir),
      usageCollector: async () => {
        startupUsageCalls += 1;
        return { schema: "fbb.pi-auth-profiles-usage/v1", profiles: [], diagnostics: [] };
      },
    });

    const statuses: Array<[string, string | undefined]> = [];
    let failNextModelRefresh = false;
    let reportNextModelRefreshError = false;
    let modelRefreshes = 0;
    const runtime = {
      login: async () => {
        throw new Error("Login not used in this fixture");
      },
      credentials: { store: new FakeAuthStore() },
    };
    const ctx = {
      cwd: projectDir,
      isProjectTrusted: () => false,
      modelRegistry: {
        runtime,
        refresh: async () => {
          modelRefreshes += 1;
          if (reportNextModelRefreshError) {
            reportNextModelRefreshError = false;
            return {
              aborted: false,
              errors: new Map([["openai-codex", new Error("model refresh failed")]]),
            };
          }
          if (failNextModelRefresh) {
            failNextModelRefresh = false;
            throw new Error("model refresh failed");
          }
        },
      },
      sessionManager: {
        getEntries: () => sessionEntries,
        getHeader: () => ({ id: activeSessionId }),
      },
      ui: {
        notify: () => undefined,
        setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
      },
    } as unknown as ExtensionCommandContext;

    const originalLogin = runtime.login;
    expect(sessionStart).toBeDefined();
    expect(profileCommand).toBeDefined();
    expect(resetCreditCommand).toBeDefined();
    await sessionStart?.({}, ctx);
    expect(runtime.login).not.toBe(originalLogin);
    const wrappedLogin = runtime.login;
    expect(statuses).toEqual([["auth-profile", "default"]]);
    expect(runtime.credentials.store.path).toBe(join(agentDir, "auth.json"));
    expect(modelRefreshes).toBe(1);

    expect(startupUsageCalls).toBe(1);
    await profileCommand?.("use work", ctx);
    expect(statuses.at(-1)).toEqual(["auth-profile", "work"]);
    expect(runtime.credentials.store.path).toBe(join(agentDir, "auth-profiles", "work.json"));
    expect(modelRefreshes).toBe(2);
    expect(sessionEntries).toEqual([
      {
        type: "custom",
        customType: "auth-profile-override",
        data: { profile: "work", sessionId: "session-1" },
      },
    ]);

    await sessionStart?.({}, ctx);
    expect(statuses.at(-1)).toEqual(["auth-profile", "work"]);

    await profileCommand?.("clear", ctx);
    expect(statuses.at(-1)).toEqual(["auth-profile", "default"]);
    expect(sessionEntries.at(-1)).toEqual({
      type: "custom",
      customType: "auth-profile-override",
      data: { profile: null, sessionId: "session-1" },
    });

    activeSessionId = "session-2";
    await sessionStart?.({}, ctx);
    expect(statuses.at(-1)).toEqual(["auth-profile", "default"]);
    expect(modelRefreshes).toBe(5);

    reportNextModelRefreshError = true;
    await profileCommand?.("use work", ctx);
    expect(runtime.credentials.store.path).toBe(join(agentDir, "auth.json"));
    expect(statuses.at(-1)).toEqual(["auth-profile", "default"]);
    expect(modelRefreshes).toBe(7);

    failNextModelRefresh = true;
    await profileCommand?.("use work", ctx);
    expect(runtime.credentials.store.path).toBe(join(agentDir, "auth.json"));
    expect(statuses.at(-1)).toEqual(["auth-profile", "default"]);
    expect(sessionEntries.at(-1)).toEqual({
      type: "custom",
      customType: "auth-profile-override",
      data: { profile: null, sessionId: "session-2" },
    });
    expect(modelRefreshes).toBe(9);
    expect(runtime.login).toBe(wrappedLogin);
    await sessionShutdown?.({}, ctx);
    expect(runtime.login).toBe(originalLogin);
  });

  test("binds the selected profile before model availability refresh", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-auth-profile-startup-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    const projectDir = join(root, "project");
    await mkdir(projectDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;

    let beforeModelAvailability: BeforeModelAvailabilityHandler | undefined;
    let sessionStart: SessionStartHandler | undefined;
    const pi = {
      on(event: string, handler: BeforeModelAvailabilityHandler | SessionStartHandler) {
        if (event === "before_model_availability") {
          beforeModelAvailability = handler as BeforeModelAvailabilityHandler;
        }
        if (event === "session_start") sessionStart = handler as SessionStartHandler;
      },
      exec: async () => ({ code: 1, killed: false, stderr: "", stdout: "" }),
      registerCommand: () => undefined,
    } as unknown as ExtensionAPI;
    const selection: ProfileSelection = {
      profile: "work",
      profileOrder: ["work", "default"],
      source: "global default",
      host: { name: "test-host", source: "system hostname" },
      hostPreferences: ["work"],
      repositoryPreferences: [],
    };
    const changedSelection: ProfileSelection = {
      ...selection,
      profile: "default",
      profileOrder: ["default", "work"],
      hostPreferences: ["default"],
    };
    const selections = [selection, changedSelection];
    let profileSelections = 0;
    authProfiles(pi, {
      providerAdapter: testProviderAdapter(agentDir),
      selectProfile: async () => {
        profileSelections += 1;
        return selections.shift() ?? changedSelection;
      },
      usageCollector: () => new Promise(() => {}),
    });

    const runtime = {
      login: async () => {
        throw new Error("Login not used in this fixture");
      },
      credentials: { store: new FakeAuthStore() },
    };
    const sessionEntries: Array<{ type: "custom"; customType: string; data: unknown }> = [];
    let modelRefreshes = 0;
    const ctx = {
      cwd: projectDir,
      isProjectTrusted: () => true,
      modelRegistry: {
        runtime,
        refresh: async () => {
          modelRefreshes += 1;
        },
      },
      sessionManager: {
        getEntries: () => sessionEntries,
        getHeader: () => ({ id: "startup-session" }),
      },
      ui: {
        notify: () => undefined,
        setStatus: () => undefined,
      },
    } as unknown as ExtensionContext;

    expect(beforeModelAvailability).toBeDefined();
    await beforeModelAvailability?.({ type: "before_model_availability", reason: "startup" }, ctx);

    expect(runtime.credentials.store.path).toBe(join(agentDir, "auth-profiles", "work.json"));
    expect(modelRefreshes).toBe(0);
    expect(profileSelections).toBe(1);

    sessionEntries.push({
      type: "custom",
      customType: "auth-profile-override",
      data: { profile: "default", sessionId: "startup-session" },
    });
    await sessionStart?.({}, ctx);

    expect(runtime.credentials.store.path).toBe(join(agentDir, "auth.json"));
    expect(modelRefreshes).toBe(1);
    expect(profileSelections).toBe(2);
    expect(existsSync(authPathFor("default", agentDir))).toBe(false);
    expect(existsSync(authPathFor("work", agentDir))).toBe(false);
  });

  test("revalidates cached usage after activity and ignores obsolete updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-auth-usage-lifecycle-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    await mkdir(agentDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const events = createEventBus();
    const snapshots: StartupOwnerSnapshot[] = [];
    events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) => {
      const snapshot = readStartupOwnerSnapshot(value);
      if (snapshot) snapshots.push(snapshot);
    });
    let sessionStart: SessionStartHandler | undefined;
    let sessionShutdown: SessionStartHandler | undefined;
    let agentEnd: SessionStartHandler | undefined;
    const pi = {
      events,
      exec: async () => ({ code: 1, killed: false, stderr: "", stdout: "" }),
      on(event: string, handler: SessionStartHandler) {
        if (event === "session_start") sessionStart = handler;
        if (event === "session_shutdown") sessionShutdown = handler;
        if (event === "agent_end") agentEnd = handler;
      },
      registerCommand: () => undefined,
    } as unknown as ExtensionAPI;
    const currentTime = Date.now();
    const payload = (count: number): UsageStatusPayload => ({
      schema: "fbb.pi-auth-profiles-usage/v1",
      profiles: [
        {
          profileLabel: "default",
          active: true,
          availableCount: count,
          urgency: "unknown",
          usage: [{ windowId: "primary", remaining: 80 }],
          [AUTH_USAGE_OBSERVATION]: {
            windows: [{ windowId: "primary", remaining: 80 }],
            observedAt: currentTime,
            staleAt: currentTime + 60_000,
            bankedResetCount: count,
          },
        },
      ],
      diagnostics: [],
    });
    const reads: CollectUsageStatusOptions[] = [];
    let cachedCount = 2;
    authProfiles(pi, {
      providerAdapter: testProviderAdapter(agentDir),
      selectProfile: async () => ({
        profile: "default",
        profileOrder: ["default"],
        source: "host default",
        host: { name: "test-host", source: "system hostname" },
        hostPreferences: [],
        repositoryPreferences: [],
      }),
      usageCollector: async (options) => {
        reads.push(options ?? {});
        return payload(cachedCount);
      },
    });
    const ctx = {
      cwd: root,
      isProjectTrusted: () => false,
      modelRegistry: {
        runtime: { login: async () => undefined, credentials: { store: new FakeAuthStore() } },
        refresh: async () => undefined,
      },
      sessionManager: { getEntries: () => [], getHeader: () => ({ id: "s" }) },
      ui: { notify: () => undefined, setStatus: () => undefined },
    } as unknown as ExtensionContext;
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
    try {
      await sessionStart?.({}, ctx);
      await flush();
      events.emit(STARTUP_OWNER_REQUEST_EVENT, createStartupOwnerRequest("s", "g", "auth"));
      expect(reads[0]?.staleWhileRevalidate).toBe(true);
      expect(snapshots.at(-1)).toMatchObject({ payload: { profiles: [{ bankedResetCount: 2 }] } });
      const oldUpdate = reads[0]?.onRevalidated;
      cachedCount = 3;
      oldUpdate?.(payload(3));
      expect(snapshots.at(-1)).toMatchObject({ payload: { profiles: [{ bankedResetCount: 3 }] } });
      await agentEnd?.({}, ctx);
      await flush();
      expect(reads).toHaveLength(2);
      reads[1]?.onRevalidated?.(payload(4));
      oldUpdate?.(payload(5));
      expect(snapshots.at(-1)).toMatchObject({ payload: { profiles: [{ bankedResetCount: 4 }] } });
      await sessionShutdown?.({}, ctx);
      const count = snapshots.length;
      reads[1]?.onRevalidated?.(payload(6));
      expect(snapshots).toHaveLength(count);
    } finally {
      await sessionShutdown?.({}, ctx);
    }
  });

  test("reports usage and reset-token status for all profiles", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-auth-profile-status-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    const currentTime = Date.parse("2026-09-02T10:00:00.000Z");
    process.env.PI_CODING_AGENT_DIR = agentDir;

    let profilesCommand: ProfileCommandHandler | undefined;
    const pi = {
      exec: async () => ({ code: 1, killed: false, stderr: "", stdout: "" }),
      on: () => undefined,
      registerCommand(name: string, command: { handler: ProfileCommandHandler }) {
        if (name === "profiles") profilesCommand = command.handler;
      },
    } as unknown as ExtensionAPI;
    const providerAdapter = testProviderAdapter(agentDir);
    const status: UsageStatusPayload = {
      schema: "fbb.pi-auth-profiles-usage/v1",
      profiles: [
        {
          profileLabel: "work",
          active: false,
          urgency: "unknown",
          usage: [],
        },
        {
          profileLabel: "claude",
          active: false,
          urgency: "unknown",
          usage: [],
          anthropicUsage: [
            { windowId: "primary", remaining: 42, resetsIn: "2h" },
            { windowId: "credit", remaining: 99, detail: "$2.78 of $500.00" },
          ],
        },
        {
          profileLabel: "default",
          active: true,
          urgency: "urgent",
          availableCount: 2,
          nextExpiresAt: "2026-09-02T16:00:00.000Z",
          usage: [
            { remaining: 75, resetsIn: "3h" },
            { remaining: 0, resetsIn: "now" },
          ],
          anthropicUsage: [{ windowId: "primary", remaining: 60, resetsIn: "1h" }],
        },
      ],
      diagnostics: [{ profileLabel: "work", code: "usage-request-failed" }],
    };
    let receivedOptions: unknown;
    const notifications: Array<{ message: string; level: string }> = [];
    authProfiles(pi, {
      now: () => currentTime,
      providerAdapter,
      usageCollector: async (options) => {
        receivedOptions = options;
        return status;
      },
    });

    expect(profilesCommand).toBeDefined();
    await profilesCommand?.("status", {
      ui: {
        notify: (message: string, level: string) => notifications.push({ message, level }),
        theme: {
          bold: (text: string) => `<b>${text}</b>`,
          fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
        },
      },
    } as unknown as ExtensionCommandContext);

    expect(receivedOptions).toMatchObject({
      activeProfile: "default",
      includeDefault: true,
      providerAdapter,
    });
    expect(notifications).toEqual([
      {
        level: "warning",
        message:
          "<success>*</success> <accent><b>default</b></accent> <success>active</success>\n" +
          "  \x1b[38;2;116;170;156m\uec81 OpenAI Codex\x1b[39m\n" +
          "    primary       <success>━━━━━━━━━━╸</success><dim>───</dim> <success>75% remaining</success><dim>  resets 3h</dim>\n" +
          "    secondary     <dim>──────────────</dim> <error>0% remaining</error><dim>  resets now</dim>\n" +
          "    banked resets <error>2 available</error><dim>  expires in 6h</dim>\n" +
          "  \x1b[38;2;183;126;100m\uec82 Anthropic\x1b[39m\n" +
          "    5h            <warning>━━━━━━━━</warning><dim>──────</dim> <warning>60% remaining</warning><dim>  resets 1h</dim>\n\n" +
          "<muted>-</muted> <accent><b>claude</b></accent> <muted>inactive</muted>\n" +
          "  \x1b[38;2;183;126;100m\uec82 Anthropic\x1b[39m\n" +
          "    5h            <b><warning>━━━━━╸</warning></b><dim>────────</dim> <b><warning>42% remaining</warning></b><dim>  resets 2h</dim>\n" +
          "    credit        <success>━━━━━━━━━━━━━╸</success><dim></dim> <success>99% remaining</success><dim>  $2.78 of $500.00</dim>\n\n" +
          "<muted>-</muted> <accent><b>work</b></accent> <muted>inactive</muted>\n" +
          "  \x1b[38;2;116;170;156m\uec81 OpenAI Codex\x1b[39m\n" +
          "    primary       <muted>unavailable</muted>\n" +
          "    secondary     <muted>unavailable</muted>\n" +
          "    banked resets <muted>unavailable</muted>\n\n" +
          "<warning><b>Diagnostics</b></warning>\n" +
          "  <muted>work:</muted> usage request failed",
      },
    ]);
  });

  test("moves only the Codex login after confirmed Codex exhaustion", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-auth-fallback-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    const projectDir = join(root, "project");
    await mkdir(join(agentDir, "auth-profiles"), { recursive: true });
    for (const profile of ["fbb", "jpb", "ct"]) {
      await writeFile(
        authPathFor(profile, agentDir),
        JSON.stringify({ "openai-codex": { type: "api_key", key: `codex-${profile}` } }),
      );
    }
    await mkdir(projectDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;

    const baseSelection = {
      profileOrder: ["fbb", "jpb", "ct", "default"],
      source: "session" as const,
      host: { name: "rvn-pc", source: "system hostname" as const },
      hostPreferences: ["fbb", "jpb", "ct"],
      repositoryPreferences: [],
    };
    let releaseRotation: (() => void) | undefined;
    const rotationGate = new Promise<void>((resolve) => {
      releaseRotation = resolve;
    });
    const selections: ProfileSelection[] = [
      { ...baseSelection, profile: "fbb", fallbackReason: "confirmed usage" },
      {
        ...baseSelection,
        profile: "jpb",
        fallbackFrom: "fbb",
        fallbackReason: "confirmed usage",
      },
      {
        ...baseSelection,
        profile: "ct",
        fallbackFrom: "jpb",
        fallbackReason: "confirmed usage",
      },
    ];
    const chooseProfile = async (
      _ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
      options: { excludedProfiles?: ReadonlySet<string>; preferredProfile?: string } = {},
    ): Promise<ProfileSelection> => {
      expect(options.preferredProfile).toBe("fbb");
      if (options.excludedProfiles?.size === 1 && options.excludedProfiles.has("fbb")) {
        await rotationGate;
      }
      const selection = selections.shift();
      if (!selection) throw new Error("unexpected profile selection");
      return selection;
    };

    let sessionStart: SessionStartHandler | undefined;
    let providerHeaders: ProviderHeadersHandler | undefined;
    let providerResponse: ProviderResponseHandler | undefined;
    const pi = {
      exec: async () => ({ code: 1, killed: false, stderr: "", stdout: "" }),
      on(
        event: string,
        handler: SessionStartHandler | ProviderHeadersHandler | ProviderResponseHandler,
      ) {
        if (event === "session_start") sessionStart = handler as SessionStartHandler;
        if (event === "before_provider_headers") {
          providerHeaders = handler as ProviderHeadersHandler;
        }
        if (event === "after_provider_response") {
          providerResponse = handler as ProviderResponseHandler;
        }
      },
      registerCommand: () => undefined,
    } as unknown as ExtensionAPI;
    authProfiles(pi, {
      now: () => 1_000_000,
      providerAdapter: {
        ...testProviderAdapter(agentDir),
        createCredentialStore: (label) => createCredentialStore(authPathFor(label, agentDir)),
      },
      selectProfile: chooseProfile,
    });

    const statuses: Array<[string, string | undefined]> = [];
    const notifications: string[] = [];
    const runtime = {
      login: async () => {
        throw new Error("Login not used in this fixture");
      },
      credentials: { store: new FakeAuthStore() as CredentialStore },
    };
    const ctx = {
      cwd: projectDir,
      isProjectTrusted: () => false,
      mode: "tui",
      model: { provider: "openai-codex" },
      modelRegistry: { runtime, refresh: async () => undefined },
      sessionManager: {
        getEntries: () => [
          {
            type: "custom",
            customType: "auth-profile-override",
            data: { profile: "fbb", sessionId: "fallback-session" },
          },
        ],
        getHeader: () => ({ id: "fallback-session" }),
      },
      ui: {
        notify: (message: string) => notifications.push(message),
        setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
      },
    } as unknown as ExtensionContext;

    await sessionStart?.({}, ctx);
    await providerResponse?.(
      {
        status: 200,
        headers: {
          "x-codex-primary-reset-after-seconds": "30",
          "x-codex-primary-used-percent": "100",
        },
      },
      ctx,
    );

    expect(providerHeaders).toBeDefined();
    const nextRequest = providerHeaders?.({}, ctx);
    if (!nextRequest) throw new Error("before_provider_headers was not registered");
    expect(await Promise.race([nextRequest.then(() => true), Bun.sleep(5).then(() => false)])).toBe(
      false,
    );
    releaseRotation?.();
    await nextRequest;

    const codexKey = async () => {
      const credential = await runtime.credentials.store.read("openai-codex");
      return credential?.type === "api_key" ? credential.key : undefined;
    };
    expect(statuses).toEqual([
      ["auth-profile", "fbb"],
      ["auth-profile", "fbb · Codex via jpb"],
    ]);
    expect(await codexKey()).toBe("codex-jpb");
    expect(notifications.at(-1)).toBe(
      "fbb reached its Codex usage limit; switched Codex to jpb.",
    );

    await providerResponse?.(
      {
        status: 429,
        headers: {
          "x-codex-primary-reset-after-seconds": "40",
          "x-codex-primary-used-percent": "100",
        },
      },
      ctx,
    );
    expect(statuses.at(-1)).toEqual(["auth-profile", "fbb · Codex via ct"]);
    expect(await codexKey()).toBe("codex-ct");
    expect(notifications.at(-1)).toBe(
      "jpb reached its Codex usage limit; switched Codex to ct.",
    );
    // The bound profile keeps serving fallback providers and /login.
    expect(statuses.every(([, value]) => value?.startsWith("fbb") === true)).toBe(true);
  });

  test("reset-credit resolves a named profile without changing the active store", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-auth-reset-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    const projectDir = join(root, "project");
    await mkdir(join(agentDir, "auth-profiles"), { recursive: true });
    await mkdir(projectDir);
    await writeFile(
      join(agentDir, "auth-profiles", "personal.json"),
      JSON.stringify({
        "openai-codex": { type: "oauth", accountId: "personal-account" },
      }),
    );
    await writeFile(
      join(agentDir, "auth-profiles", "work.json"),
      JSON.stringify({
        "openai-codex": { type: "oauth", accountId: "work-account" },
      }),
    );
    process.env.PI_CODING_AGENT_DIR = agentDir;

    let resetCreditCommand: ResetCreditCommandHandler | undefined;
    const pi = {
      on: () => undefined,
      registerCommand(name: string, command: { handler: ResetCreditCommandHandler }) {
        if (name === "reset-credit") resetCreditCommand = command.handler;
      },
    } as unknown as ExtensionAPI;
    authProfiles(pi, { providerAdapter: testProviderAdapter(agentDir) });

    const originalStore = new FakeAuthStore();
    const runtime = {
      login: async () => {
        throw new Error("Login not used in this fixture");
      },
      credentials: { store: originalStore },
    };
    const fetchRequests: Array<{
      url: string;
      accountId: string | null;
      method: string | undefined;
    }> = [];
    const getProviderAuth = async () => ({
      auth: { apiKey: `access:${runtime.credentials.store.path}` },
    });
    const selections = ["work (availability unknown)"];
    let questionIndex = 0;
    const ctx = {
      cwd: projectDir,
      isProjectTrusted: () => true,
      hasUI: true,
      isIdle: () => true,
      mode: "tui",
      modelRegistry: { runtime, getProviderAuth, refresh: async () => undefined },
      ui: {
        notify: () => undefined,
        setStatus: () => undefined,
        custom: async (factory: InlineQuestionFactory, options: { overlay?: boolean }) => {
          expect(options).toEqual({ overlay: false });
          const target = questionIndex++ === 0 ? selections.shift() : undefined;
          return new Promise((resolve) => {
            const component = factory(
              { requestRender: () => undefined },
              { fg: (_color, text) => text },
              {
                matches: (data, binding) =>
                  binding === "tui.select.up"
                    ? data === "up" || data === "ctrl+k"
                    : binding === "tui.select.down"
                      ? data === "down" || data === "ctrl+j"
                      : binding === "tui.select.confirm"
                        ? data === "enter" || data === "\r"
                        : data === "escape",
                getKeys: (binding) =>
                  binding === "tui.select.up"
                    ? ["up"]
                    : binding === "tui.select.down"
                      ? ["down"]
                      : binding === "tui.select.confirm"
                        ? ["enter"]
                        : ["escape"],
              },
              resolve,
            );
            const rendered = () => component.render(200).join("\n");
            if (rendered().includes("Answer:")) {
              for (const character of "CONSUME") component.handleInput?.(character);
              component.handleInput?.("\r");
              return;
            }
            if (target !== undefined) {
              for (let attempt = 0; attempt < 10; attempt += 1) {
                const targetIsHighlighted = rendered()
                  .split("\n")
                  .some((line) => line.includes(target) && line.includes("▶"));
                if (targetIsHighlighted) {
                  component.handleInput?.("enter");
                  return;
                }
                component.handleInput?.("down");
              }
            }
            component.handleInput?.("enter");
          });
        },
        select: async () => {
          throw new Error("reset-credit used popup select instead of ask_user_question");
        },
        input: async () => {
          throw new Error("reset-credit used popup input instead of ask_user_question");
        },
      },
    } as unknown as ExtensionCommandContext;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      fetchRequests.push({
        url,
        accountId: new Headers(init?.headers).get("ChatGPT-Account-Id"),
        method: init?.method,
      });
      if (url.endsWith("/consume")) return Response.json({ windows_reset: 1 });
      return Response.json({
        available_count: 1,
        credits: [
          {
            id: "work-credit",
            status: "available",
            title: "Work reset",
            expires_at: "2026-09-02T16:00:00Z",
          },
        ],
      });
    }) as typeof fetch;

    try {
      await resetCreditCommand?.("", ctx);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(runtime.credentials.store).toBe(originalStore);
    expect(fetchRequests.filter((request) => request.url.endsWith("/consume"))).toEqual([
      {
        url: "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume",
        accountId: "work-account",
        method: "POST",
      },
    ]);
    expect(
      fetchRequests.every(
        (request) =>
          request.accountId === "personal-account" || request.accountId === "work-account",
      ),
    ).toBe(true);
  });
});

describe("anthropic usage-limit rotation", () => {
  type MessageEndHandler = (
    event: { message: { role: string; stopReason: string; errorMessage?: string } },
    ctx: ExtensionContext,
  ) => Promise<void>;
  const RATE_LIMIT =
    '429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit."}}';
  const anthropicOAuth = (access: string) => ({
    anthropic: {
      type: "oauth" as const,
      access,
      refresh: `refresh-${access}`,
      expires: 9_999_999_999_999,
    },
  });

  async function setup(usage: Record<string, Array<{ remaining: number; resetAt?: number }>>) {
    const root = await mkdtemp(join(tmpdir(), "pi-auth-anthropic-rotation-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    const projectDir = join(root, "project");
    await mkdir(join(agentDir, "auth-profiles"), { recursive: true });
    await mkdir(projectDir);
    process.env.PI_CODING_AGENT_DIR = agentDir;
    for (const profile of ["fbb", "jpb"]) {
      await writeFile(
        authPathFor(profile, agentDir),
        JSON.stringify({
          ...anthropicOAuth(profile),
          "openai-codex": { type: "api_key", key: `codex-${profile}` },
        }),
      );
    }
    await writeFile(authPathFor("default", agentDir), JSON.stringify(anthropicOAuth("default")));

    let currentTime = 1_000_000;
    const selection: ProfileSelection = {
      profile: "fbb",
      profileOrder: ["fbb", "jpb", "default"],
      source: "host default",
      host: { name: "rvn-pc", source: "system hostname" },
      hostPreferences: ["fbb", "jpb"],
      repositoryPreferences: [],
    };
    const usageRequests: Array<readonly string[] | undefined> = [];
    const handlers: {
      sessionStart?: SessionStartHandler;
      providerHeaders?: ProviderHeadersHandler;
      messageEnd?: MessageEndHandler;
    } = {};
    const pi = {
      exec: async () => ({ code: 1, killed: false, stderr: "", stdout: "" }),
      on(event: string, handler: unknown) {
        if (event === "session_start") handlers.sessionStart = handler as SessionStartHandler;
        if (event === "before_provider_headers") {
          handlers.providerHeaders = handler as ProviderHeadersHandler;
        }
        if (event === "message_end") handlers.messageEnd = handler as MessageEndHandler;
      },
      registerCommand: () => undefined,
    } as unknown as ExtensionAPI;
    authProfiles(pi, {
      now: () => currentTime,
      providerAdapter: {
        ...testProviderAdapter(agentDir),
        createCredentialStore: (label) => createCredentialStore(authPathFor(label, agentDir)),
      },
      selectProfile: async () => selection,
      usageCollector: async (options) => {
        usageRequests.push(options?.profileLabels);
        return {
          schema: "fbb.pi-auth-profiles-usage/v1",
          diagnostics: [],
          profiles: Object.entries(usage).map(([profileLabel, windows]) => ({
            profileLabel,
            active: profileLabel === "fbb",
            usage: [],
            urgency: "unknown" as const,
            anthropicUsage: windows.map(({ remaining, resetAt }, index) => ({
              windowId: index === 0 ? "primary" : "secondary",
              remaining,
              ...(resetAt === undefined ? {} : { allowanceResetAt: resetAt }),
            })),
          })),
        };
      },
    });

    const statuses: Array<[string, string | undefined]> = [];
    const notifications: string[] = [];
    const credentials = { store: new FakeAuthStore() as CredentialStore };
    const runtime = {
      login: async (providerId: string, _type: string, interaction: { signal?: AbortSignal }) =>
        credentials.store.modify(
          providerId,
          async () => anthropicOAuth("reauthed").anthropic,
          interaction.signal === undefined ? undefined : { signal: interaction.signal },
        ),
      credentials,
    };
    const ctx = {
      cwd: projectDir,
      isProjectTrusted: () => false,
      mode: "tui",
      model: { provider: "anthropic" },
      modelRegistry: { runtime, refresh: async () => undefined },
      sessionManager: { getEntries: () => [], getHeader: () => ({ id: "rotation-session" }) },
      ui: {
        notify: (message: string) => notifications.push(message),
        setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
      },
    } as unknown as ExtensionContext;
    await handlers.sessionStart?.({}, ctx);

    const anthropicAccess = async () => {
      const credential = await runtime.credentials.store.read("anthropic");
      return credential?.type === "oauth" ? credential.access : undefined;
    };
    const fail = async (errorMessage: string) => {
      await handlers.providerHeaders?.({}, ctx);
      await handlers.messageEnd?.(
        { message: { role: "assistant", stopReason: "error", errorMessage } },
        ctx,
      );
    };
    return {
      agentDir,
      anthropicAccess,
      fail,
      notifications,
      runtime,
      statuses,
      usageRequests,
      advance: (ms: number) => {
        currentTime += ms;
      },
    };
  }

  test("moves Anthropic to the next owner with confirmed usage and keeps the profile", async () => {
    const fixture = await setup({
      fbb: [{ remaining: 0, resetAt: 1_000_000 + 3_600_000 }],
      jpb: [{ remaining: 60 }],
      default: [{ remaining: 90 }],
    });
    expect(await fixture.anthropicAccess()).toBe("fbb");

    await fixture.fail(RATE_LIMIT);

    expect(await fixture.anthropicAccess()).toBe("jpb");
    expect(fixture.notifications.at(-1)).toBe(
      "fbb reached its Anthropic usage limit; switched Anthropic to jpb.",
    );
    expect(fixture.statuses).toEqual([["auth-profile", "fbb"]]);
    const codex = await fixture.runtime.credentials.store.read("openai-codex");
    expect(codex?.type === "api_key" ? codex.key : undefined).toBe("codex-fbb");
    expect(fixture.usageRequests.at(-1)).toEqual(["fbb", "jpb", "default"]);

    fixture.advance(3_600_001);
    expect(await fixture.anthropicAccess()).toBe("fbb");
  });

  test("skips an unconfirmed owner and returns to the profile order after the reset", async () => {
    const fixture = await setup({
      fbb: [{ remaining: 0, resetAt: 1_000_000 + 60_000 }],
      jpb: [],
      default: [{ remaining: 40 }],
    });

    await fixture.fail(RATE_LIMIT);
    expect(await fixture.anthropicAccess()).toBe("default");

    fixture.advance(60_001);
    expect(await fixture.anthropicAccess()).toBe("fbb");
  });

  test("keeps the owner when no alternate has confirmed usage", async () => {
    const fixture = await setup({
      fbb: [{ remaining: 0 }],
      jpb: [{ remaining: 0 }],
      default: [],
    });

    await fixture.fail(RATE_LIMIT);

    expect(await fixture.anthropicAccess()).toBe("fbb");
    expect(fixture.notifications.at(-1)).toBe(
      "fbb reached its Anthropic usage limit; no alternate profile has confirmed available Anthropic usage.",
    );
  });
  test("skips a rejected Anthropic OAuth owner on subsequent requests", async () => {
    const fixture = await setup({ fbb: [{ remaining: 50 }], jpb: [{ remaining: 50 }] });
    const store = fixture.runtime.credentials.store;
    let rejectedRefreshes = 0;
    const refresh = async (current: Awaited<ReturnType<CredentialStore["read"]>>) => {
      if (current?.type === "oauth" && current.access === "fbb") {
        rejectedRefreshes += 1;
        throw new Error('HTTP 400 {"error":"invalid_grant"}');
      }
      return undefined;
    };

    const first = await store.modify("anthropic", refresh);
    expect(first?.type === "oauth" ? first.access : undefined).toBe("jpb");
    expect(await fixture.anthropicAccess()).toBe("jpb");
    expect((await store.modify("anthropic", refresh))?.type).toBe("oauth");
    expect(rejectedRefreshes).toBe(1);
    expect(fixture.notifications.at(-1)).toBe(
      "fbb Anthropic OAuth refresh was rejected; switched Anthropic to jpb.",
    );
    expect(fixture.statuses).toEqual([["auth-profile", "fbb"]]);
    await fixture.runtime.login("anthropic", "oauth", {});
    expect(await fixture.anthropicAccess()).toBe("reauthed");
  });

  test("ignores Anthropic errors that are not usage limits", async () => {
    const fixture = await setup({ fbb: [{ remaining: 0 }], jpb: [{ remaining: 60 }] });

    await fixture.fail('529 {"type":"error","error":{"type":"overloaded_error"}}');

    expect(await fixture.anthropicAccess()).toBe("fbb");
    expect(fixture.usageRequests).toEqual([]);
    expect(fixture.notifications).toEqual([]);
  });
});

describe("per-provider binding", () => {
  test("a usage fallback at startup moves only Codex and keeps Anthropic on the bound profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-auth-startup-fallback-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    await mkdir(join(agentDir, "auth-profiles"), { recursive: true });
    process.env.PI_CODING_AGENT_DIR = agentDir;
    for (const profile of ["fbb", "jpb"]) {
      await writeFile(
        authPathFor(profile, agentDir),
        JSON.stringify({
          anthropic: { type: "oauth", access: profile, refresh: "r", expires: 9_999_999_999_999 },
          "openai-codex": { type: "api_key", key: `codex-${profile}` },
        }),
      );
    }
    let sessionStart: SessionStartHandler | undefined;
    const pi = {
      exec: async () => ({ code: 1, killed: false, stderr: "", stdout: "" }),
      on(event: string, handler: SessionStartHandler) {
        if (event === "session_start") sessionStart = handler;
      },
      registerCommand: () => undefined,
    } as unknown as ExtensionAPI;
    authProfiles(pi, {
      providerAdapter: {
        ...testProviderAdapter(agentDir),
        createCredentialStore: (label) => createCredentialStore(authPathFor(label, agentDir)),
      },
      selectProfile: async () => ({
        profile: "jpb",
        fallbackFrom: "fbb",
        fallbackReason: "confirmed usage",
        profileOrder: ["fbb", "jpb", "default"],
        source: "host default",
        host: { name: "rvn-pc", source: "system hostname" },
        hostPreferences: ["fbb", "jpb"],
        repositoryPreferences: [],
      }),
      usageCollector: async () => ({
        schema: "fbb.pi-auth-profiles-usage/v1",
        profiles: [],
        diagnostics: [],
      }),
    });
    const statuses: Array<[string, string | undefined]> = [];
    const runtime = {
      login: async () => {
        throw new Error("Login not used in this fixture");
      },
      credentials: { store: new FakeAuthStore() as CredentialStore },
    };
    const ctx = {
      cwd: root,
      isProjectTrusted: () => false,
      mode: "tui",
      modelRegistry: { runtime, refresh: async () => undefined },
      sessionManager: { getEntries: () => [], getHeader: () => ({ id: "s" }) },
      ui: {
        notify: () => undefined,
        setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
      },
    } as unknown as ExtensionContext;

    await sessionStart?.({}, ctx);

    const codex = await runtime.credentials.store.read("openai-codex");
    const anthropic = await runtime.credentials.store.read("anthropic");
    expect(codex?.type === "api_key" ? codex.key : undefined).toBe("codex-jpb");
    expect(anthropic?.type === "oauth" ? anthropic.access : undefined).toBe("fbb");
    expect(statuses.at(-1)).toEqual(["auth-profile", "fbb · Codex via jpb"]);
  });
});
