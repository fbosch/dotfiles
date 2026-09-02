import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { permissionSystemConfigPath, registerYoloCommand, toggleYoloMode } from "../yolo";

type YoloCommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;
type SessionStartHandler = (event: unknown, ctx: ExtensionContext) => void;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function temporaryAgentDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-yolo-"));
  temporaryDirectories.push(root);
  const agentDirectory = join(root, "agent");
  await mkdir(join(agentDirectory, "extensions", "pi-permission-system"), { recursive: true });
  return agentDirectory;
}

function captureCommand(agentDirectory: string): {
  handler: YoloCommandHandler;
  commandName: string;
  sessionStart: SessionStartHandler | undefined;
} {
  let handler: YoloCommandHandler | undefined;
  let commandName = "";
  let sessionStart: SessionStartHandler | undefined;
  const pi = {
    registerCommand(name: string, command: { handler: YoloCommandHandler }) {
      commandName = name;
      handler = command.handler;
    },
    on(name: string, candidate: SessionStartHandler) {
      if (name === "session_start") sessionStart = candidate;
    },
  } as unknown as ExtensionAPI;

  registerYoloCommand(pi, agentDirectory);
  if (handler === undefined) throw new Error("YOLO command was not registered");
  return { handler, commandName, sessionStart };
}

describe("YOLO mode", () => {
  test("toggles the config value while preserving the permission policy", async () => {
    const agentDirectory = await temporaryAgentDirectory();
    const configPath = permissionSystemConfigPath(agentDirectory);
    await writeFile(
      configPath,
      `{
  // Keep comments accepted by pi-permission-system.
  "yoloMode": false,
  "permission": { "*": "ask" }
}
`,
    );

    expect(toggleYoloMode(agentDirectory)).toEqual({ enabled: true, configPath });
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      yoloMode: true,
      permission: { "*": "ask" },
    });

    expect(toggleYoloMode(agentDirectory).enabled).toBeFalse();
    expect(JSON.parse(await readFile(configPath, "utf8")).yoloMode).toBeFalse();
  });

  test("restores the enabled status on session start", async () => {
    const agentDirectory = await temporaryAgentDirectory();
    await writeFile(permissionSystemConfigPath(agentDirectory), JSON.stringify({ yoloMode: true }));
    const { sessionStart } = captureCommand(agentDirectory);
    if (sessionStart === undefined)
      throw new Error("YOLO session-start handler was not registered");

    const statuses: Array<[string, string | undefined]> = [];
    const context = {
      ui: {
        setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
        theme: {
          fg: (color: string, value: string) => `${color}:${value}`,
        },
      },
    } as unknown as ExtensionContext;

    sessionStart({}, context);

    expect(statuses).toEqual([["pi-permission-system", "error:󱚝 yolo"]]);
  });

  test("reports the new state without reloading the UI", async () => {
    const agentDirectory = await temporaryAgentDirectory();
    const { handler, commandName } = captureCommand(agentDirectory);
    const notifications: Array<[string, string]> = [];
    const statuses: Array<[string, string | undefined]> = [];
    let reloads = 0;
    const context = {
      ui: {
        notify: (message: string, level: string) => notifications.push([message, level]),
        setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
        theme: {
          fg: (color: string, value: string) => `${color}:${value}`,
        },
      },
      reload: async () => {
        reloads += 1;
      },
    } as unknown as ExtensionCommandContext;

    await handler("", context);

    expect(commandName).toBe("yolo");
    expect(statuses).toEqual([["pi-permission-system", "error:󱚝 yolo"]]);
    expect(reloads).toBe(0);
    expect(notifications).toEqual([
      [
        "Global YOLO mode enabled. Ask-state permission checks and MCP tool approvals are auto-approved. Explicit denies still block.",
        "warning",
      ],
    ]);
  });

  test("does not overwrite malformed config", async () => {
    const agentDirectory = await temporaryAgentDirectory();
    const configPath = permissionSystemConfigPath(agentDirectory);
    const malformed = '{\n  "yoloMode": false,\n';
    await writeFile(configPath, malformed);

    expect(() => toggleYoloMode(agentDirectory)).toThrow("Cannot load permission-system config");
    expect(await readFile(configPath, "utf8")).toBe(malformed);
  });
});
