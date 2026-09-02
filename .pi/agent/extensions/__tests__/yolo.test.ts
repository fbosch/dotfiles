import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  handleMcpToolApprovalRequest,
  permissionSystemConfigPath,
  registerYoloCommand,
  toggleYoloMode,
} from "../yolo";

type YoloCommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

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
} {
  let handler: YoloCommandHandler | undefined;
  let commandName = "";
  const pi = {
    registerCommand(name: string, command: { handler: YoloCommandHandler }) {
      commandName = name;
      handler = command.handler;
    },
  } as unknown as ExtensionAPI;

  registerYoloCommand(pi, agentDirectory);
  if (handler === undefined) throw new Error("YOLO command was not registered");
  return { handler, commandName };
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

  test("auto-approves MCP tool runs only while YOLO mode is enabled", async () => {
    const agentDirectory = await temporaryAgentDirectory();
    let approvalHandler: (() => "allow_once" | Promise<"allow_once">) | undefined;
    const request = {
      serverName: "github",
      originalToolName: "delete_issue",
      args: { issue: 42 },
      claim(handler: () => "allow_once" | Promise<"allow_once">) {
        approvalHandler = handler;
        return true;
      },
    };

    expect(handleMcpToolApprovalRequest(request, agentDirectory)).toBe(false);
    expect(approvalHandler).toBeUndefined();

    await writeFile(
      permissionSystemConfigPath(agentDirectory),
      JSON.stringify({ yoloMode: true, permission: { "*": "deny" } }),
    );

    expect(handleMcpToolApprovalRequest(request, agentDirectory)).toBe(true);
    if (approvalHandler === undefined) throw new Error("MCP approval was not claimed");
    expect(await approvalHandler()).toBe("allow_once");
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
      },
      reload: async () => {
        reloads += 1;
      },
    } as unknown as ExtensionCommandContext;

    await handler("", context);

    expect(commandName).toBe("yolo");
    expect(statuses).toEqual([["pi-permission-system", "yolo"]]);
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
