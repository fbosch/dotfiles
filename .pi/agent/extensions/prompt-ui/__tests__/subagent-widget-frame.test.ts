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
import {
  colorizeSubagentWidgetLine,
  installSubagentWidgetFrame,
  linkSubagentWidgetLines,
} from "../subagent-widget-frame";

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
  getColorMode: () => "truecolor",
} as unknown as Theme;
const tui = { terminal: { columns: 80 }, requestRender: () => {} } as unknown as TUI;

describe("subagent widget frame", () => {
  test("colorizes configured agent names without touching activity lines", () => {
    const colors = new Map([["Review", "#a8d0e6"]]);
    const header = "└─ ⠋ \u001b[1mReview\u001b[22m  Reviewing code";
    const activity = "│    ⎿  Review the findings";

    const coloredHeader = colorizeSubagentWidgetLine(header, colors, theme);
    const coloredActivity = colorizeSubagentWidgetLine(activity, colors, theme);

    expect(coloredHeader).toContain("\u001b[38;2;168;208;230mReview\u001b[39m");
    expect(stripTerminalSequences(coloredHeader)).toBe("└─ ⠋ Review  Reviewing code");
    expect(coloredActivity).toBe(activity);
  });

  test("applies colors through the installed widget wrapper", () => {
    const { calls, ui } = createUI();
    const widget: WidgetComponent = {
      render: () => ["└─ ⠋ \u001b[1mReview\u001b[22m  Reviewing code"],
      invalidate: () => {},
    };
    const uninstall = installSubagentWidgetFrame(ui, {
      agentColors: new Map([["Review", "#a8d0e6"]]),
    });

    ui.setWidget("agents", () => widget, { placement: "aboveEditor" });

    const factory = calls[0]?.content;
    expect(typeof factory).toBe("function");
    if (typeof factory !== "function") throw new Error("Expected a widget factory");
    const framed = factory(tui, theme);

    expect(framed.render(80).some((line) => line.includes("\u001b[38;2;168;208;230mReview"))).toBe(
      true,
    );
    uninstall();
  });

  test("links a service-spawned agent to its transcript from the widget", () => {
    const { calls, ui } = createUI();
    const widget: WidgetComponent = {
      render: () => [
        "● Agents",
        "└─ ⠋ \u001b[1mgeneral\u001b[22m (twin)  Create an ADR · 3 turns · 1.2s",
        "     ⎿  thinking…",
      ],
      invalidate: () => {},
    };
    const uninstall = installSubagentWidgetFrame(ui, {
      agentColors: new Map(),
      agentDisplayNames: new Map([["general", "general"]]),
      getSubagents: () => [
        {
          id: "agent-1",
          type: "general",
          description: "Create an ADR",
          status: "running",
          isBackground: true,
        },
      ],
    });

    ui.setWidget("agents", () => widget, { placement: "aboveEditor" });

    const factory = calls[0]?.content;
    expect(typeof factory).toBe("function");
    if (typeof factory !== "function") throw new Error("Expected a widget factory");
    const rendered = factory(tui, theme).render(80);

    expect(rendered[2]).toContain("pi-action://subagents/session?id=agent-1");
    expect(rendered[3]).not.toContain("pi-action://subagents/session");
    uninstall();
  });

  test("keeps linking rows when the published service is removed after installation", () => {
    const serviceKey = Symbol.for("@gotgenes/pi-subagents:service");
    const globals = globalThis as Record<symbol, unknown>;
    const previousService = globals[serviceKey];
    globals[serviceKey] = {
      listAgents: () => [
        {
          id: "captured-agent",
          type: "explore",
          description: "Inspect reload behavior",
          status: "running",
          isBackground: true,
        },
      ],
    };
    const { calls, ui } = createUI();
    const uninstall = installSubagentWidgetFrame(ui, {
      agentColors: new Map(),
      agentDisplayNames: new Map([["explore", "explore"]]),
    });
    ui.setWidget("agents", () => ({
      render: () => [
        "● Agents",
        "└─ ⠋ explore  Inspect reload behavior · 1 turn · 1.0s",
        "     ⎿  thinking…",
      ],
      invalidate: () => {},
    }));
    delete globals[serviceKey];

    try {
      const factory = calls[0]?.content;
      if (typeof factory !== "function") throw new Error("Expected a widget factory");

      expect(factory(tui, theme).render(80)[2]).toContain(
        "pi-action://subagents/session?id=captured-agent",
      );
    } finally {
      uninstall();
      if (previousService === undefined) delete globals[serviceKey];
      else globals[serviceKey] = previousService;
    }
  });

  test("maps mixed and duplicate running rows by the widget's render order", () => {
    const displayNames = new Map([["general", "general"]]);
    const lines = [
      "● Agents",
      "├─ ✓ general  Completed ADR · 1.0s",
      "├─ ⠋ general  Repeated task · 1.1s",
      "│    ⎿  thinking…",
      "└─ ⠙ general  Repeated task · 1.2s",
      "     ⎿  reading…",
      "└─ ◌ 1 queued",
    ];
    const linked = linkSubagentWidgetLines(
      lines,
      [
        {
          id: "running-newer",
          type: "general",
          description: "Repeated task",
          status: "running",
          isBackground: true,
        },
        {
          id: "finished",
          type: "general",
          description: "Completed ADR",
          status: "completed",
          isBackground: true,
          completedAt: 1,
        },
        {
          id: "running-older",
          type: "general",
          description: "Repeated task",
          status: "running",
          isBackground: true,
        },
        {
          id: "queued",
          type: "general",
          description: "Queued task",
          status: "queued",
          isBackground: true,
        },
      ],
      displayNames,
    );

    expect(linked[1]).toContain("id=finished");
    expect(linked[2]).toContain("id=running-newer");
    expect(linked[4]).toContain("id=running-older");
    expect(linked[6]).not.toContain("pi-action://subagents/session");
  });

  test("uses the full visible description to distinguish completed sessions", () => {
    const linked = linkSubagentWidgetLines(
      ["└─ ✓ general  Create an ADR for routing · 1.0s"],
      [
        {
          id: "routing",
          type: "general",
          description: "Create an ADR for routing",
          status: "completed",
          isBackground: true,
          completedAt: 2,
        },
        {
          id: "caching",
          type: "general",
          description: "Create an ADR for caching",
          status: "completed",
          isBackground: true,
          completedAt: 1,
        },
      ],
      new Map([["general", "general"]]),
    );

    expect(linked[0]).toContain("id=routing");
  });

  test("does not guess between indistinguishable completed sessions", () => {
    const linked = linkSubagentWidgetLines(
      ["└─ ✓ general  Repeated task · 1.0s"],
      [
        {
          id: "finished-newer",
          type: "general",
          description: "Repeated task",
          status: "completed",
          isBackground: true,
          completedAt: 2,
        },
        {
          id: "finished-older",
          type: "general",
          description: "Repeated task",
          status: "completed",
          isBackground: true,
          completedAt: 1,
        },
      ],
      new Map([["general", "general"]]),
    );

    expect(linked[0]).not.toContain("pi-action://subagents/session");
  });

  test("renders the agents widget with a half-height bottom edge", () => {
    const { calls, ui } = createUI();
    let renderedWidth = 0;
    let invalidations = 0;
    let disposals = 0;
    const widget: WidgetComponent = {
      render: (width) => {
        renderedWidth = width;
        return ["● Agents", "└─ ⠋ Plan  Designing prompt seam with extra output"];
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
    expect(plain).toHaveLength(4);
    expect(plain[0]).toBe(" ".repeat(32));
    expect(plain[1]).toContain("  ● Agents");
    expect(plain[2]).toContain("  └─ ⠋ Plan");
    expect(plain[2]).not.toContain("extra output");
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

  test("does not add bottom padding to the todo widget dock", () => {
    const { calls, ui } = createUI();
    let renderedWidth = 0;
    const widget: WidgetComponent = {
      render: (width) => {
        renderedWidth = width;
        return ["○ Todos (0/1)", "└─ ○ Review this task with extra output", ""];
      },
      invalidate: () => {},
    };

    const uninstall = installSubagentWidgetFrame(ui, {
      agentColors: new Map([["Review", "#a8d0e6"]]),
    });
    ui.setWidget("rpiv-todos", () => widget, { placement: "aboveEditor" });

    const factory = calls[0]?.content;
    expect(typeof factory).toBe("function");
    if (typeof factory !== "function") throw new Error("Expected a widget factory");
    const framed = factory(tui, theme);
    const rendered = framed.render(32);
    const plain = rendered.map(stripTerminalSequences);

    expect(renderedWidth).toBe(28);
    expect(plain).toHaveLength(4);
    expect(plain[0]).toBe(" ".repeat(32));
    expect(plain[1]).toContain("  ○ Todos");
    expect(plain[2]).toContain("  └─ ○ Review this task");
    expect(plain[2]).not.toContain("extra output");
    expect(rendered.some((line) => line.includes("\u001b[38;2;168;208;230mReview"))).toBe(false);
    expect(rendered.slice(0, -1).every((line) => line.includes("\u001b[48;2;34;34;34m"))).toBe(
      true,
    );
    expect(plain.at(-1)).toBe("▀".repeat(32));
    expect(rendered.every((line) => visibleWidth(line) === 32)).toBe(true);

    uninstall();
  });

  test("does not render a frame when the wrapped widget is empty", () => {
    const { calls, ui } = createUI();
    const widget: WidgetComponent = {
      render: () => [],
      invalidate: () => {},
    };
    const uninstall = installSubagentWidgetFrame(ui);
    ui.setWidget("rpiv-todos", () => widget, { placement: "aboveEditor" });

    const factory = calls[0]?.content;
    expect(typeof factory).toBe("function");
    if (typeof factory !== "function") throw new Error("Expected a widget factory");
    const framed = factory(tui, theme);

    expect(framed.render(32)).toEqual([]);
    uninstall();
  });

  test("leaves other widgets and static content unchanged", () => {
    const { calls, ui } = createUI();
    const factory: WidgetFactory = () => ({ render: () => ["other"], invalidate: () => {} });
    const staticContent = ["agent"];
    const uninstall = installSubagentWidgetFrame(ui);

    ui.setWidget("other", factory);
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
