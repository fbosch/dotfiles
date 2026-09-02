import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import authProfiles from "../index";

type SessionStartHandler = (event: unknown, ctx: ExtensionContext) => Promise<void>;
type ProfileCommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

type ResetCreditCommandHandler = ProfileCommandHandler;

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

class FakeAuthStore {
  static create(path?: string): FakeAuthStore {
    return new FakeAuthStore(path);
  }

  constructor(readonly path?: string) {}
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
    const pi = {
      on(event: string, handler: SessionStartHandler) {
        if (event === "session_start") sessionStart = handler;
      },
      registerCommand(name: string, command: { handler: ProfileCommandHandler }) {
        if (name === "profile") profileCommand = command.handler;
        if (name === "reset-credit") resetCreditCommand = command.handler;
      },
    } as unknown as ExtensionAPI;
    authProfiles(pi);

    const statuses: Array<[string, string | undefined]> = [];
    const runtime = {
      credentials: { store: new FakeAuthStore() },
      forceRefreshAvailability: async () => undefined,
    };
    const ctx = {
      cwd: projectDir,
      isProjectTrusted: () => true,
      modelRegistry: { runtime },
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

    await profileCommand?.("use work", ctx);
    expect(statuses.at(-1)).toEqual(["auth-profile", "work"]);
    expect(runtime.credentials.store.path).toBe(join(agentDir, "auth-profiles", "work.json"));
    const projectSettings = await readFile(join(projectDir, ".pi", "settings.json"), "utf8");
    expect(projectSettings).toBe('{\n  "authProfile": "work"\n}\n');
    expect(JSON.parse(projectSettings)).toEqual({ authProfile: "work" });
  });

  test("reset-credit resolves a named profile and restores the active store", async () => {
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
    authProfiles(pi);

    const runtime = {
      credentials: { store: new FakeAuthStore() },
      forceRefreshAvailability: async () => undefined,
    };
    const fetchRequests: Array<{
      url: string;
      accountId: string | null;
      method: string | undefined;
    }> = [];
    const getProviderAuth = async () => ({
      auth: { apiKey: `access:${runtime.credentials.store.path}` },
    });
    const selections = ["work (1 available)"];
    const ctx = {
      cwd: projectDir,
      isProjectTrusted: () => true,
      hasUI: true,
      isIdle: () => true,
      mode: "tui",
      modelRegistry: { runtime, getProviderAuth },
      ui: {
        notify: () => undefined,
        setStatus: () => undefined,
        select: async (_title: string, options: string[]) => {
          const selection = selections.shift();
          return selection ?? options[0];
        },
        input: async () => "CONSUME",
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

    expect(runtime.credentials.store.path).toBe(join(agentDir, "auth.json"));
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
