import { describe, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import type {
  ExtensionAPI,
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

function captureRegistration() {
  let tool: ToolDefinition | undefined;
  const pi = {
    registerTool(definition: ToolDefinition) {
      tool = definition;
    },
  } as unknown as ExtensionAPI;

  return { pi, getTool: () => tool };
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

  test("does not register tools outside Hyprland", () => {
    const { pi, getTool } = captureRegistration();

    registerHyprlandExtension(pi, { environment: {} });

    expect(getTool()).toBeUndefined();
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

  test("reports missing capture commands as tool failures", async () => {
    let tool: ToolDefinition | undefined;
    const pi = {
      registerTool(definition: ToolDefinition) {
        tool = definition;
      },
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
