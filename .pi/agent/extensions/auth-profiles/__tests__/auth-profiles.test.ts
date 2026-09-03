import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import authProfiles from "../index";
import type { ProfileSelection } from "../profile-selector";
import { accountIdFor, authPathFor } from "../profile-store";
import type { ProfileProviderAdapter } from "../provider-adapter";
import { createOpenAiCodexProfileAdapter } from "../providers/openai-codex";

type SessionStartHandler = (event: unknown, ctx: ExtensionContext) => Promise<void>;
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
      },
      registerCommand(name: string, command: { handler: ProfileCommandHandler }) {
        if (name === "profile") profileCommand = command.handler;
        if (name === "reset-credit") resetCreditCommand = command.handler;
      },
    } as unknown as ExtensionAPI;
    authProfiles(pi, { providerAdapter: testProviderAdapter(agentDir) });

    const statuses: Array<[string, string | undefined]> = [];
    let failNextModelRefresh = false;
    let modelRefreshes = 0;
    const runtime = {
      credentials: { store: new FakeAuthStore() },
    };
    const ctx = {
      cwd: projectDir,
      isProjectTrusted: () => false,
      modelRegistry: {
        runtime,
        refresh: async () => {
          modelRefreshes += 1;
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

    expect(sessionStart).toBeDefined();
    expect(profileCommand).toBeDefined();
    expect(resetCreditCommand).toBeDefined();
    await sessionStart?.({}, ctx);
    expect(statuses).toEqual([["auth-profile", "default"]]);
    expect(runtime.credentials.store.path).toBe(join(agentDir, "auth.json"));
    expect(modelRefreshes).toBe(1);

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

    failNextModelRefresh = true;
    await profileCommand?.("use work", ctx);
    expect(runtime.credentials.store.path).toBe(join(agentDir, "auth.json"));
    expect(statuses.at(-1)).toEqual(["auth-profile", "default"]);
    expect(sessionEntries.at(-1)).toEqual({
      type: "custom",
      customType: "auth-profile-override",
      data: { profile: null, sessionId: "session-2" },
    });
    expect(modelRefreshes).toBe(7);
  });

  test("switches a session-preferred profile after confirmed Codex exhaustion", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-auth-fallback-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    const projectDir = join(root, "project");
    await mkdir(agentDir);
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
      providerAdapter: testProviderAdapter(agentDir),
      selectProfile: chooseProfile,
    });

    const statuses: Array<[string, string | undefined]> = [];
    const notifications: string[] = [];
    const runtime = {
      credentials: { store: new FakeAuthStore() },
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

    expect(statuses).toEqual([
      ["auth-profile", "fbb"],
      ["auth-profile", "jpb"],
    ]);
    expect(runtime.credentials.store.path).toBe(join(agentDir, "auth-profiles", "jpb.json"));
    expect(notifications.at(-1)).toBe("fbb exhausted; switched to jpb. Retry the request.");

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
    expect(statuses.at(-1)).toEqual(["auth-profile", "ct"]);
    expect(runtime.credentials.store.path).toBe(join(agentDir, "auth-profiles", "ct.json"));
    expect(notifications.at(-1)).toBe("jpb exhausted; switched to ct. Retry the request.");
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
