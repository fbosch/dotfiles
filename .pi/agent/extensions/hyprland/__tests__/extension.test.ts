import { describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  type HyprlandCommandRunner,
  registerHyprlandExtension,
  supportsHyprlandSession,
} from "../index";

const environment = {
  HYPRLAND_INSTANCE_SIGNATURE: "fixture",
  XDG_RUNTIME_DIR: "/run/user/1000",
  WAYLAND_DISPLAY: "wayland-1",
};

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

function captureRegistration() {
  let tool: ToolDefinition | undefined;
  const tools = new Map<string, ToolDefinition>();
  let command: { handler: CommandHandler } | undefined;
  let commandName = "";
  const messages: Array<{ content: string; options?: unknown }> = [];
  const pi = {
    registerTool(definition: ToolDefinition) {
      tool = definition;
      tools.set(definition.name, definition);
    },
    registerCommand(name: string, definition: { handler: CommandHandler }) {
      commandName = name;
      command = definition;
    },
    sendUserMessage(content: string, options?: unknown) {
      messages.push({ content, options });
    },
  } as unknown as ExtensionAPI;

  return {
    pi,
    getTool: (name?: string) => (name === undefined ? tool : tools.get(name)),
    getCommand: () => command,
    getCommandName: () => commandName,
    getMessages: () => messages,
  };
}

describe("Hyprland extension", () => {
  test("requires a complete Hyprland Wayland environment", () => {
    expect(supportsHyprlandSession({})).toBeFalse();
    expect(
      supportsHyprlandSession({
        HYPRLAND_INSTANCE_SIGNATURE: "fixture",
        XDG_RUNTIME_DIR: "/run/user/1000",
      }),
    ).toBeFalse();
    expect(supportsHyprlandSession(environment)).toBeTrue();
  });

  test("keeps the hypr-prop command visible outside Hyprland while gating the tool", () => {
    const { pi, getTool, getCommandName } = captureRegistration();

    registerHyprlandExtension(pi, { environment: {} });

    expect(getTool()).toBeUndefined();
    expect(getCommandName()).toBe("hypr-prop");
  });
  test("recovers the session environment from systemd before running hyprprop", async () => {
    const { pi, getCommand, getMessages } = captureRegistration();
    const calls: Array<{
      command: string;
      args: string[];
      cwd: string;
      environment: Readonly<Record<string, string>> | undefined;
    }> = [];
    const commandRunner: HyprlandCommandRunner = async (
      command,
      args,
      cwd,
      _signal,
      commandEnvironment,
    ) => {
      calls.push({ command, args, cwd, environment: commandEnvironment });
      if (command === "systemctl") {
        return {
          stdout:
            "HYPRLAND_INSTANCE_SIGNATURE=fixture\nXDG_RUNTIME_DIR=/run/user/1000\nWAYLAND_DISPLAY=wayland-1\n",
          stderr: "",
          exitCode: 0,
        };
      }
      return {
        stdout: '{"class":"kitty"}\n',
        stderr: "",
        exitCode: 0,
      };
    };

    registerHyprlandExtension(pi, {
      environment: { XDG_RUNTIME_DIR: "/run/user/1000" },
      commandRunner,
    });
    const command = getCommand();
    if (command === undefined) throw new Error("Hyprprop command was not registered");

    const notifications: string[] = [];
    await command.handler("", {
      cwd: "/tmp",
      isIdle: () => true,
      ui: { notify: (message: string) => notifications.push(message) },
    } as unknown as ExtensionCommandContext);

    expect(calls).toEqual([
      {
        command: "systemctl",
        args: ["--user", "show-environment"],
        cwd: "/tmp",
        environment: undefined,
      },
      {
        command: "hyprprop",
        args: ["--raw"],
        cwd: "/tmp",
        environment: {
          HYPRLAND_INSTANCE_SIGNATURE: "fixture",
          XDG_RUNTIME_DIR: "/run/user/1000",
          WAYLAND_DISPLAY: "wayland-1",
        },
      },
    ]);
    expect(notifications).toEqual([]);
    expect(getMessages()).toEqual([
      {
        content: expect.stringContaining('"class":"kitty"'),
        options: { expandPromptTemplates: false },
      },
    ]);
  });
  test("runs hyprprop and sends compact selected-window properties to the agent", async () => {
    const { pi, getCommand, getCommandName, getMessages } = captureRegistration();
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const commandRunner: HyprlandCommandRunner = async (command, args, cwd) => {
      calls.push({ command, args, cwd });
      return {
        stdout:
          '{"address":"0x1","mapped":true,"hidden":false,"visible":true,"acceptsInput":true,"at":[1,2],"size":[3,4],"workspace":{"id":1,"name":"1"},"floating":false,"monitor":0,"class":"kitty","title":"Fixture","pid":42,"xwayland":false,"pinned":false,"fullscreen":0,"tags":[],"contentType":"none","stableId":"0xstable"}\n',
        stderr: "",
        exitCode: 0,
      };
    };

    registerHyprlandExtension(pi, { environment, commandRunner });
    const command = getCommand();
    if (command === undefined) throw new Error("Hyprprop command was not registered");

    const notifications: string[] = [];
    await command.handler("", {
      cwd: "/tmp",
      isIdle: () => true,
      ui: { notify: (message: string) => notifications.push(message) },
    } as unknown as ExtensionCommandContext);

    expect(getCommandName()).toBe("hypr-prop");
    expect(calls).toEqual([{ command: "hyprprop", args: ["--raw"], cwd: "/tmp" }]);
    expect(notifications).toEqual([]);
    expect(getMessages()).toEqual([
      {
        content: expect.stringContaining(
          '{"address":"0x1","at":[1,2],"size":[3,4],"workspace":{"id":1,"name":"1"},"monitor":0,"class":"kitty","title":"Fixture","pid":42,"stableId":"0xstable"}',
        ),
        options: { expandPromptTemplates: false },
      },
    ]);
    expect(getMessages()[0]?.content).not.toContain('"hidden"');
  });

  test("sends the complete selected-window JSON in raw mode", async () => {
    const { pi, getCommand, getMessages } = captureRegistration();
    const rawOutput = '{"address":"0x1","hidden":false,"title":"Fixture","tags":[]}';
    const commandRunner: HyprlandCommandRunner = async () => ({
      stdout: `${rawOutput}\n`,
      stderr: "",
      exitCode: 0,
    });

    registerHyprlandExtension(pi, { environment, commandRunner });
    const command = getCommand();
    if (command === undefined) throw new Error("Hyprprop command was not registered");

    const notifications: string[] = [];
    await command.handler("raw", {
      cwd: "/tmp",
      isIdle: () => true,
      ui: { notify: (message: string) => notifications.push(message) },
    } as unknown as ExtensionCommandContext);

    const message = getMessages()[0]?.content ?? "";
    expect(message).toContain("Here is the selected window's raw JSON:");
    expect(message).toContain(rawOutput);
    expect(notifications).toEqual([]);
  });

  test("registers a screenshot tool and returns Pi image content", async () => {
    const { pi, getTool } = captureRegistration();
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    let outputPath: string | undefined;
    const commandRunner: HyprlandCommandRunner = async (command, args, cwd) => {
      calls.push({ command, args, cwd });
      if (command === "grim") {
        outputPath = args.at(-1);
        if (outputPath === undefined) throw new Error("grim output path is missing");
        await writeFile(outputPath, Buffer.from("fixture-png"));
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    registerHyprlandExtension(pi, { environment, commandRunner });
    const tool = getTool();
    if (tool === undefined) throw new Error("Hyprland tool was not registered");

    try {
      const result = await tool.execute(
        "call-1",
        {
          region: { x: 1, y: 2, width: 3, height: 4 },
          format: "png",
        },
        undefined,
        undefined,
        { cwd: "/tmp" } as ExtensionContext,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        command: "grim",
        cwd: "/tmp",
      });
      expect(calls[0]?.args.slice(0, -1)).toEqual(["-g", "1,2 3x4"]);
      expect(result.content[0]).toEqual({
        type: "text",
        text: expect.stringContaining("Method: region"),
      });
      expect(result.content[1]).toEqual({
        type: "image",
        data: Buffer.from("fixture-png").toString("base64"),
        mimeType: "image/png",
      });
      expect(result.details).toMatchObject({
        method: "region",
        geometry: { x: 1, y: 2, width: 3, height: 4 },
      });
    } finally {
      if (outputPath !== undefined) await rm(outputPath, { force: true });
    }
  });

  test("captures an active window using its compositor geometry", async () => {
    const { pi, getTool } = captureRegistration();
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    let outputPath: string | undefined;
    const client = {
      address: "0x1234",
      stableId: "18000008",
      mapped: true,
      monitor: 1,
      class: "kitty",
      initialClass: "kitty",
      title: "Fixture",
      visible: true,
      at: [10, 20],
      size: [300, 200],
    };
    const commandRunner: HyprlandCommandRunner = async (command, args, cwd) => {
      calls.push({ command, args, cwd });
      if (command === "hyprctl") {
        const request = args[0];
        const response =
          request === "activewindow"
            ? client
            : request === "clients"
              ? [client]
              : request === "monitors"
                ? [{ x: 0, y: 0, width: 1920, height: 1080, name: "DP-1", focused: true, id: 1 }]
                : {};
        return { stdout: JSON.stringify(response), stderr: "", exitCode: 0 };
      }

      outputPath = args.at(-1);
      if (outputPath === undefined) throw new Error("grim output path is missing");
      await writeFile(outputPath, Buffer.from("fixture-png"));
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    registerHyprlandExtension(pi, { environment, commandRunner });
    const tool = getTool();
    if (tool === undefined) throw new Error("Hyprland tool was not registered");

    try {
      const result = await tool.execute("call-1", { mode: "window" }, undefined, undefined, {
        cwd: "/tmp",
      } as ExtensionContext);

      const grimCall = calls.find(({ command }) => command === "grim");
      expect(grimCall).toMatchObject({ command: "grim", cwd: "/tmp" });
      expect(grimCall?.args.slice(0, -1)).toEqual(["-g", "10,20 300x200"]);
      expect(result.details).toMatchObject({
        method: "window",
        geometry: { x: 10, y: 20, width: 300, height: 200 },
      });
    } finally {
      if (outputPath !== undefined) await rm(outputPath, { force: true });
    }
  });

  test("collects compositor and runtime health in one diagnostic snapshot", async () => {
    const { pi, getTool } = captureRegistration();
    const diagnosticEnvironment = { ...environment, HOME: "/fixture" };
    const calls: Array<{
      command: string;
      args: string[];
      cwd: string;
      environment: Readonly<Record<string, string>> | undefined;
    }> = [];
    const client = {
      address: "0x1234",
      stableId: "18000008",
      mapped: true,
      monitor: 1,
      class: "kitty",
      initialClass: "kitty",
      title: "Fixture",
      visible: true,
      at: [10, 20],
      size: [300, 200],
      workspace: { id: 2, name: "2", monitor: "DP-1" },
    };
    const commandRunner: HyprlandCommandRunner = async (
      command,
      args,
      cwd,
      _signal,
      commandEnvironment,
    ) => {
      calls.push({ command, args, cwd, environment: commandEnvironment });
      if (command === "hyprctl") {
        const request = args[0];
        if (request === "configerrors") {
          return { stdout: "no errors found\n", stderr: "", exitCode: 0 };
        }
        const response =
          request === "activewindow"
            ? client
            : request === "activeworkspace"
              ? { id: 2, name: "2", monitor: "DP-1" }
              : request === "clients"
                ? [client]
                : request === "monitors"
                  ? [{ x: 0, y: 0, width: 1920, height: 1080, name: "DP-1", focused: true, id: 1 }]
                  : {
                      "DP-1": {
                        levels: { 2: [{ namespace: "waybar", x: 0, y: 1000, w: 1920, h: 80 }] },
                      },
                    };
        return { stdout: JSON.stringify(response), stderr: "", exitCode: 0 };
      }
      if (command.endsWith("/profilectl.sh")) {
        return {
          stdout: JSON.stringify({
            generation: 3,
            resolved: "gaming",
            selection: "auto",
            sources: { gaming: { watchdog: 1 }, powersave: {} },
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (command.endsWith("/presentation-status.sh")) {
        return {
          stdout: Array.from({ length: 250 }, (_, index) => `presentation line ${index}`).join(
            "\n",
          ),
          stderr: "",
          exitCode: 0,
        };
      }
      if (command.endsWith("/window-capturectl.sh")) {
        return { stdout: "daemon=running\nworker=paused\n", stderr: "", exitCode: 0 };
      }
      if (command.endsWith("/waybar-process.sh")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "unexpected command", exitCode: 1 };
    };

    registerHyprlandExtension(pi, { environment: diagnosticEnvironment, commandRunner });
    const tool = getTool("hypr_desktop_diagnose");
    if (tool === undefined) throw new Error("Hyprland diagnostic tool was not registered");

    const result = await tool.execute("call-1", {}, undefined, undefined, {
      cwd: "/tmp",
    } as ExtensionContext);
    const text = result.content[0];
    if (text?.type !== "text") throw new Error("Diagnostic result did not contain text");

    expect(result.details).toMatchObject({
      compositor: {
        activeWindow: { className: "kitty", workspace: { name: "2" } },
        activeWorkspace: { id: 2, name: "2", monitor: "DP-1" },
        clients: [{ title: "Fixture" }],
        monitors: [{ name: "DP-1", focused: true }],
        layers: [{ namespace: "waybar", monitor: "DP-1", level: "2" }],
        configErrors: [],
      },
      runtime: {
        profile: { resolved: "gaming", selection: "auto" },
        windowCapture: { daemon: "running", worker: "paused" },
        waybar: "running",
      },
      unavailable: [],
    });
    expect(text.text).toContain("Hyprland desktop diagnostic");
    expect(text.text).toContain("Config errors: none");
    expect(text.text).toContain("resolved=gaming");
    expect(text.text).toContain("... 210 more presentation lines omitted");
    expect(calls.map(({ command, args }) => `${command} ${args.join(" ")}`)).toEqual(
      expect.arrayContaining([
        "hyprctl activewindow -j",
        "hyprctl activeworkspace -j",
        "hyprctl clients -j",
        "hyprctl monitors -j",
        "hyprctl layers -j",
        "hyprctl configerrors",
        "/fixture/.config/hypr/runtime/profiles/profilectl.sh status --json",
        "/fixture/.config/hypr/runtime/gaming/presentation-status.sh ",
        "/fixture/.config/hypr/runtime/windows/daemons/window-capture/window-capturectl.sh status",
        "/fixture/.config/hypr/runtime/desktop/waybar-process.sh running",
      ]),
    );
    expect(
      calls
        .filter(({ command }) => command === "hyprctl")
        .every(({ environment }) => environment?.HYPRLAND_INSTANCE_SIGNATURE === "fixture"),
    ).toBeTrue();
  });

  test("reports unavailable diagnostic sources without discarding healthy state", async () => {
    const { pi, getTool } = captureRegistration();
    const diagnosticEnvironment = { ...environment, HOME: "/fixture" };
    const commandRunner: HyprlandCommandRunner = async (command, args) => {
      if (command === "hyprctl" && args[0] === "configerrors") {
        return { stdout: "", stderr: "config query failed", exitCode: 1 };
      }
      if (command === "hyprctl") {
        const request = args[0];
        const response =
          request === "activewindow"
            ? { class: "kitty", title: "Fixture" }
            : request === "activeworkspace"
              ? { id: 1, name: "1", monitor: "DP-1" }
              : request === "clients"
                ? []
                : request === "monitors"
                  ? [{ x: 0, y: 0, width: 1920, height: 1080, name: "DP-1", focused: true, id: 1 }]
                  : {};
        return { stdout: JSON.stringify(response), stderr: "", exitCode: 0 };
      }
      if (command.endsWith("/profilectl.sh")) {
        return { stdout: "", stderr: "profile state unavailable", exitCode: 1 };
      }
      if (command.endsWith("/presentation-status.sh")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.endsWith("/window-capturectl.sh")) {
        return { stdout: "daemon=running\n", stderr: "", exitCode: 0 };
      }
      if (command.endsWith("/waybar-process.sh")) {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    registerHyprlandExtension(pi, { environment: diagnosticEnvironment, commandRunner });
    const tool = getTool("hypr_desktop_diagnose");
    if (tool === undefined) throw new Error("Hyprland diagnostic tool was not registered");

    const result = await tool.execute("call-1", {}, undefined, undefined, {
      cwd: "/tmp",
    } as ExtensionContext);
    const diagnosticDetails = result.details as {
      unavailable: Array<{ source: string; error: string }>;
    };

    expect(result.details).toMatchObject({
      compositor: { configErrors: null, activeWorkspace: { name: "1" } },
      runtime: { profile: null, presentation: "", windowCapture: null, waybar: "stopped" },
    });
    expect(diagnosticDetails.unavailable).toEqual(
      expect.arrayContaining([
        { source: "configerrors", error: "configerrors: config query failed" },
        { source: "profile", error: "runtime/profiles/profilectl.sh: profile state unavailable" },
        { source: "window-capture", error: "returned unexpected status output" },
      ]),
    );
  });

  test("reports missing capture commands as tool failures", async () => {
    let tool: ToolDefinition | undefined;
    const pi = {
      registerTool(definition: ToolDefinition) {
        tool = definition;
      },
      registerCommand() {},
      exec: async () => {
        throw new Error("spawn ENOENT");
      },
    } as unknown as ExtensionAPI;

    registerHyprlandExtension(pi, { environment });
    if (tool === undefined) throw new Error("Hyprland tool was not registered");

    let error: unknown;
    try {
      await tool.execute(
        "call-1",
        { region: { x: 1, y: 2, width: 3, height: 4 } },
        undefined,
        undefined,
        { cwd: "/tmp" } as ExtensionContext,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) return;
    expect(error.message).toContain("spawn ENOENT");
  });
});
