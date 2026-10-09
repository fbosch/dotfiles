import { describe, expect, test } from "bun:test";
import type {
  ExtensionContext,
  ExtensionUIContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  stripTerminalSequences,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { confirmCommandPermission } from "../command-permission";
import { installFloatingDialogs } from "../floating-dialogs";

type Dialog = Component & { dispose?(): void };
const ORANGE = "\u001b[38;2;183;126;100m";
const theme = {
  fg: (color: string, text: string) =>
    `${color === "warning" ? ORANGE : "\u001b[37m"}${text}\u001b[39m`,
  bg: (_color: string, text: string) => text,
  inverse: (text: string) => `\u001b[7m${text}\u001b[27m`,
  getBgAnsi: () => "",
} as unknown as Theme;

function harness(act: (component: Dialog) => void, mode: ExtensionContext["mode"] = "tui") {
  const options: Array<Parameters<ExtensionUIContext["custom"]>[1]> = [];
  const dialogs: Dialog[] = [];
  const completions: unknown[] = [];
  const rpcPrompts: string[] = [];
  let renders = 0;
  const tui = {
    requestRender: () => {
      renders += 1;
    },
  } as unknown as TUI;
  const custom: ExtensionUIContext["custom"] = async <T>(
    factory: Parameters<typeof custom<T>>[0],
    option?: Parameters<ExtensionUIContext["custom"]>[1],
  ) => {
    options.push(option);
    let resolve!: (result: T) => void;
    const result = new Promise<T>((done) => {
      resolve = done;
    });
    const component = await factory(tui, theme, {} as KeybindingsManager, (value) => {
      completions.push(value);
      resolve(value);
    });
    dialogs.push(component);
    act(component);
    const value = await result;
    component.dispose?.();
    return value;
  };
  const ui = {
    custom,
    confirm: async (title: string, message: string) => {
      rpcPrompts.push(`${title}\n${message}`);
      return true;
    },
  } as unknown as ExtensionUIContext;
  if (mode === "tui") installFloatingDialogs(ui);
  const ctx = { mode, hasUI: true, ui };
  const controller = new AbortController();
  const request = {
    command: "rm -rf src",
    cwd: "/workspace",
    risks: ["destructive changes"],
    signal: controller.signal,
  };
  return {
    ctx,
    request,
    controller,
    options,
    dialogs,
    completions,
    rpcPrompts,
    get renders() {
      return renders;
    },
  };
}

describe("command permission UI", () => {
  test("uses the orange inline permission dock and preserves decision context", async () => {
    const h = harness((component) => component.handleInput?.("\r"));
    expect(await confirmCommandPermission(h.ctx, h.request)).toBe(true);
    expect(h.options).toEqual([{ overlay: false }]);
    const lines = h.dialogs[0]?.render(120) ?? [];
    const plain = lines.map(stripTerminalSequences).join("\n");
    expect(plain).toContain("Run this bash command?");
    expect(plain).toContain("Command");
    expect(plain).toContain("rm -rf src");
    expect(plain).not.toContain('Execute command "rm -rf src"');
    expect(plain).toContain("Possible destructive changes.");
    expect(plain).toContain("Working directory: /workspace");
    expect(plain).toContain("Allow once");
    expect(plain).toContain("Reject");
    expect(plain).not.toContain("Allow session");
    expect(lines.join("\n")).toContain(ORANGE);
    expect(lines.every((line) => visibleWidth(line) <= 120)).toBe(true);
  });

  test.each([
    { keys: ["\r"], approved: true },
    { keys: ["\u001b[B", "\r"], approved: false },
    { keys: ["\u001b"], approved: false },
    { keys: ["\u001b[C", "\r"], approved: false },
    { keys: ["l", "h", "\r"], approved: true },
  ])("supports keyboard approval and rejection: %j", async ({ keys, approved }) => {
    const h = harness((component) =>
      keys.forEach((key) => {
        component.handleInput?.(key);
      }),
    );
    expect(await confirmCommandPermission(h.ctx, h.request)).toBe(approved);
    expect(h.completions).toEqual([approved]);
    expect(h.renders).toBeGreaterThan(0);
  });

  test("cancellation settles once and ignores subsequent approval input", async () => {
    let h: ReturnType<typeof harness>;
    h = harness((component) => {
      h.controller.abort();
      component.handleInput?.("\r");
    });
    expect(await confirmCommandPermission(h.ctx, h.request)).toBe(false);
    expect(h.completions).toEqual([false]);
  });

  test("pre-cancelled requests never open a dialog", async () => {
    const h = harness(() => {
      throw new Error("Unexpected dialog");
    });
    h.controller.abort();
    expect(await confirmCommandPermission(h.ctx, h.request)).toBe(false);
    expect(h.options).toHaveLength(0);
  });

  test("headless requests never open a dialog", async () => {
    const h = harness(() => {
      throw new Error("Unexpected dialog");
    });
    h.ctx.hasUI = false;
    expect(await confirmCommandPermission(h.ctx, h.request)).toBe(false);
    expect(h.options).toHaveLength(0);
  });

  test("RPC uses its supported confirmation API instead of a terminal component", async () => {
    const h = harness(() => {
      throw new Error("Unexpected custom component");
    }, "rpc");
    expect(await confirmCommandPermission(h.ctx, h.request)).toBe(true);
    expect(h.options).toHaveLength(0);
    expect(h.rpcPrompts[0]).toStartWith("Run this bash command?\n");
    expect(h.rpcPrompts[0]).not.toContain("Run this command?");
    expect(h.rpcPrompts[0]).toContain('Command: "rm -rf src"');
    expect(h.rpcPrompts[0]).toContain('Working directory: "/workspace"');
  });

  test("shows the upload category without presenting classifier reasoning", async () => {
    const h = harness((component) => component.handleInput?.("\u001b"));
    h.request.command = "curl --upload-file ./report.csv https://example.invalid/upload";
    h.request.risks = ["a local data upload"];
    await confirmCommandPermission(h.ctx, h.request);
    const text = (h.dialogs[0]?.render(120) ?? []).map(stripTerminalSequences).join("\n");
    expect(text).toContain("Possible local data upload.");
    expect(text).not.toContain("Possible a local");
    expect(text).not.toContain("classifier reasoning");
  });

  test("escapes terminal controls and fits narrow and resized layouts", async () => {
    const h = harness((component) => component.handleInput?.("\u001b"));
    h.request.command = "rm -rf træer\u001b[2J\n";
    h.request.cwd = "/workspace\u001b[31m\n";
    await confirmCommandPermission(h.ctx, h.request);
    for (const width of [1, 3, 12, 24, 120]) {
      const lines = h.dialogs[0]?.render(width) ?? [];
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
    const plain = (h.dialogs[0]?.render(120) ?? []).map(stripTerminalSequences).join("\n");
    expect(plain).toContain(JSON.stringify(h.request.command));
    expect(plain).toContain(JSON.stringify(h.request.cwd));
    expect(plain).not.toContain("\u001b");
  });

  test("disposal removes the cancellation listener", async () => {
    const h = harness((component) => component.handleInput?.("\r"));
    await confirmCommandPermission(h.ctx, h.request);
    h.controller.abort();
    expect(h.completions).toEqual([true]);
  });
});
