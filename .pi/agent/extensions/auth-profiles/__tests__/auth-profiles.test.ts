import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
    const pi = {
      on(event: string, handler: SessionStartHandler) {
        if (event === "session_start") sessionStart = handler;
      },
      registerCommand(name: string, command: { handler: ProfileCommandHandler }) {
        if (name === "profile") profileCommand = command.handler;
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
});
