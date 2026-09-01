import { describe, expect, test } from "bun:test";
import type {
  ExtensionUIContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";
import { installFloatingDialogs } from "../floating-dialogs";

type CustomOptions = Parameters<ExtensionUIContext["custom"]>[1];

function createUI() {
  const calls: CustomOptions[] = [];
  const components: Component[] = [];
  const theme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as Theme;
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

  test("preserves explicit custom component placement", async () => {
    const { calls, ui } = createUI();
    installFloatingDialogs(ui);

    await ui.custom(
      (_tui, _theme, _keybindings, done) => {
        done(undefined);
        return { render: () => [], invalidate: () => {} };
      },
      { overlay: false },
    );

    expect(calls).toEqual([{ overlay: false }]);
  });
});
