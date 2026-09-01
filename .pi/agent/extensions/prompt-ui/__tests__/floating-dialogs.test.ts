import { describe, expect, test } from "bun:test";
import {
  type ExtensionUIContext,
  initTheme,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { installFloatingDialogs } from "../floating-dialogs";

type CustomOptions = Parameters<ExtensionUIContext["custom"]>[1];

initTheme("dark");

function createUI() {
  const calls: CustomOptions[] = [];
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
    const component = await factory(tui, {} as Theme, {} as KeybindingsManager, finish);
    component.handleInput?.("\r");
    return result;
  };
  const ui = {
    custom,
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  } as unknown as ExtensionUIContext;

  return { calls, ui };
}

describe("floating extension dialogs", () => {
  test("opens shared select and input primitives as overlays", async () => {
    const { calls, ui } = createUI();
    installFloatingDialogs(ui);

    await ui.select("Settings", ["First", "Second"]);
    await ui.input("Value");

    expect(calls).toEqual([
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: 72, maxHeight: "80%", margin: 1 },
      },
      {
        overlay: true,
        overlayOptions: { anchor: "center", width: 72, maxHeight: "80%", margin: 1 },
      },
    ]);
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

    expect(calls).toEqual([
      {
        overlay: false,
        overlayOptions: { anchor: "center", width: 72, maxHeight: "80%", margin: 1 },
      },
    ]);
  });
});
