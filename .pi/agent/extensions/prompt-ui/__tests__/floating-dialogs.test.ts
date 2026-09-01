import { describe, expect, test } from "bun:test";
import type {
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
import { installFloatingDialogs } from "../floating-dialogs";
import { modalSelectedRow } from "../modal-frame";

type CustomOptions = Parameters<ExtensionUIContext["custom"]>[1];

function createUI() {
  const calls: CustomOptions[] = [];
  const components: Component[] = [];
  const theme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    getBgAnsi: () => "\u001b[48;2;34;34;34m",
    inverse: (text: string) => text,
  } as unknown as Theme;
  const tui = {
    terminal: { columns: 120, rows: 40 },
    requestRender: () => {},
  } as unknown as TUI;
  const custom = async <T>(
    factory: (
      tui: TUI,
      theme: Theme,
      keybindings: KeybindingsManager,
      done: (result: T) => void,
    ) => Component | Promise<Component>,
    options?: CustomOptions,
  ): Promise<T> => {
    calls.push(options);
    let finish: (result: T) => void = () => {};
    const result = new Promise<T>((resolve) => {
      finish = resolve;
    });
    const component = await factory(tui, theme, {} as KeybindingsManager, finish);
    components.push(component);
    component.handleInput?.("\r");
    return result;
  };
  const ui = {
    custom,
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  } as unknown as ExtensionUIContext;

  return { calls, components, ui };
}

describe("floating extension dialogs", () => {
  test("renders selected rows as inverse accent bars", () => {
    const theme = {
      fg: (color: string, text: string) => `[${color}]${text}`,
      inverse: (text: string) => `[inverse]${text}`,
    } as Theme;

    expect(modalSelectedRow(theme, "Selected item")).toBe("[inverse][accent]Selected item");
  });

  test("opens shared select and input primitives with the palette UI", async () => {
    const { calls, components, ui } = createUI();
    installFloatingDialogs(ui);

    await ui.select("Settings", ["First", "Second"]);
    await ui.input("Value");

    expect(calls).toEqual([
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: 72, margin: 1 },
      },
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: 72, margin: 1 },
      },
    ]);
    const selectDialog = stripTerminalSequences(components[0]?.render(68).join("\n") ?? "");
    const inputDialog = stripTerminalSequences(components[1]?.render(68).join("\n") ?? "");
    expect(selectDialog).toContain("Settings");
    expect(selectDialog).toContain("→ First");
    expect(selectDialog).toContain("↑↓ navigate · Enter select · Esc close");
    expect(inputDialog).toContain("Value");
    expect(inputDialog).toContain("Enter submit · Esc close");
  });

  test("renders explicit inline components in the prompt dock", async () => {
    const { calls, components, ui } = createUI();
    installFloatingDialogs(ui);
    let handledInput = "";

    await ui.custom(
      (_tui, _theme, _keybindings, done) => {
        return {
          render: () => ["Permission required"],
          handleInput: (data) => {
            handledInput = data;
            done(undefined);
          },
          invalidate: () => {},
        };
      },
      { overlay: false },
    );

    expect(calls).toEqual([{ overlay: false }]);
    expect(handledInput).toBe("\r");
    const rendered = components[0]?.render(28) ?? [];
    const plain = rendered.map(stripTerminalSequences);
    expect(plain[1]).toContain(" Permission required");
    expect(plain.at(-1)).toBe(`▘${"▀".repeat(26)}▝`);
    expect(rendered.every((line) => visibleWidth(line) === 28)).toBe(true);
    expect(rendered[1]).toContain("\u001b[48;2;34;34;34m");
  });
});
