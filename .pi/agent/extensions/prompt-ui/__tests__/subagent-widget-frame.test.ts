import { describe, expect, test } from "bun:test";
import type {
  ExtensionUIContext,
  ExtensionWidgetOptions,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  stripTerminalSequences,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { installSubagentWidgetFrame } from "../subagent-widget-frame";

type WidgetComponent = Component & { dispose?(): void };
type WidgetFactory = (tui: TUI, theme: Theme) => WidgetComponent;
type WidgetContent = string[] | WidgetFactory | undefined;
type SetWidgetCall = {
  key: string;
  content: WidgetContent;
  options?: ExtensionWidgetOptions;
};

function createUI() {
  const calls: SetWidgetCall[] = [];
  const setWidget = (
    key: string,
    content: WidgetContent,
    options?: ExtensionWidgetOptions,
  ): void => {
    calls.push({ key, content, ...(options === undefined ? {} : { options }) });
  };
  const ui = { setWidget } as unknown as ExtensionUIContext;
  return { calls, originalSetWidget: ui.setWidget, ui };
}

const theme = {
  fg: (_color: string, text: string) => text,
  getBgAnsi: () => "\u001b[48;2;34;34;34m",
} as unknown as Theme;
const tui = { terminal: { columns: 80 }, requestRender: () => {} } as unknown as TUI;

describe("subagent widget frame", () => {
  test("renders the agents widget as a padded full-width dock", () => {
    const { calls, ui } = createUI();
    let renderedWidth = 0;
    let invalidations = 0;
    let disposals = 0;
    const widget: WidgetComponent = {
      render: (width) => {
        renderedWidth = width;
        return ["● Agents", "└─ ⠋ Plan  Designing prompt seam"];
      },
      invalidate: () => {
        invalidations += 1;
      },
      dispose: () => {
        disposals += 1;
      },
    };

    const uninstall = installSubagentWidgetFrame(ui);
    ui.setWidget("agents", () => widget, { placement: "aboveEditor" });

    const factory = calls[0]?.content;
    expect(typeof factory).toBe("function");
    if (typeof factory !== "function") throw new Error("Expected a widget factory");
    const framed = factory(tui, theme);
    const rendered = framed.render(32);
    const plain = rendered.map(stripTerminalSequences);

    expect(renderedWidth).toBe(28);
    expect(plain).toHaveLength(5);
    expect(plain[0]).toBe(" ".repeat(32));
    expect(plain[1]).toContain("  ● Agents");
    expect(plain[2]).toContain("  └─ ⠋ Plan");
    expect(plain.some((line) => line.includes("▌") || line.includes("▐"))).toBe(false);
    expect(plain.at(-1)).toBe("▀".repeat(32));
    expect(rendered.slice(0, -1).every((line) => line.includes("\u001b[48;2;34;34;34m"))).toBe(
      true,
    );
    expect(rendered.every((line) => visibleWidth(line) === 32)).toBe(true);

    framed.invalidate();
    framed.dispose?.();
    expect(invalidations).toBe(1);
    expect(disposals).toBe(1);
    uninstall();
  });

  test("leaves other widgets and static agent content unchanged", () => {
    const { calls, ui } = createUI();
    const factory: WidgetFactory = () => ({ render: () => ["todo"], invalidate: () => {} });
    const staticContent = ["agent"];
    const uninstall = installSubagentWidgetFrame(ui);

    ui.setWidget("todo", factory);
    ui.setWidget("agents", staticContent);

    expect(calls[0]?.content).toBe(factory);
    expect(calls[1]?.content).toBe(staticContent);
    uninstall();
  });

  test("shares one patch across owners and restores the original method", () => {
    const { originalSetWidget, ui } = createUI();
    const uninstallFirst = installSubagentWidgetFrame(ui);
    const patchedSetWidget = ui.setWidget;
    const uninstallSecond = installSubagentWidgetFrame(ui);

    expect(ui.setWidget).toBe(patchedSetWidget);
    uninstallFirst();
    expect(ui.setWidget).toBe(patchedSetWidget);
    uninstallSecond();
    expect(ui.setWidget).toBe(originalSetWidget);
  });
});
