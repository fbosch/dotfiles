import { describe, expect, test } from "bun:test";
import { type ExtensionUIContext, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { type Terminal, type TUI, TuiAltScreen } from "@earendil-works/pi-tui";
import {
  armDirectSubagentSessionSelection,
  findSubagentSessionOption,
  installSubagentSessionUrlHandler,
  installSubagentToolLinks,
  linkSubagentToolBlock,
  parseSubagentSessionUrl,
  type SubagentSessionRecord,
  type SubagentSessionTarget,
  subagentSessionUrl,
} from "../subagent-session-links";

const toolRenderPatch = Symbol.for("dotfiles:pi-subagent-session-tool-links");
const tuiUrlPatch = Symbol.for("dotfiles:pi-subagent-session-url-handler");
const target: SubagentSessionTarget = {
  agentId: "agent/one",
  displayName: "Explore",
  description: "Survey repository context",
};
const records: SubagentSessionRecord[] = [
  {
    id: target.agentId,
    type: "explore",
    description: target.description,
    status: "completed",
    toolUses: 3,
  },
];

function createToolExecution(toolName = "subagent"): ToolExecutionComponent {
  return Object.assign(Object.create(ToolExecutionComponent.prototype), {
    toolName,
    result: {
      details: {
        agentId: target.agentId,
        displayName: target.displayName,
        description: target.description,
      },
    },
  }) as ToolExecutionComponent;
}

function stubToolRender(lines: string[]): () => void {
  const prototype = ToolExecutionComponent.prototype;
  const originalRender = prototype.render;
  prototype.render = () => [...lines];
  return () => {
    prototype.render = originalRender;
  };
}

class TestTerminal implements Terminal {
  readonly columns = 80;
  readonly rows = 10;
  readonly kittyProtocolActive = false;
  private onInput: ((data: string) => void) | undefined;

  start(onInput: (data: string) => void): void {
    this.onInput = onInput;
  }

  send(data: string): void {
    this.onInput?.(data);
  }

  stop(): void {}
  async drainInput(): Promise<void> {}
  write(): void {}
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

describe("subagent session links", () => {
  test("round-trips an exact subagent target through the internal URL", () => {
    expect(parseSubagentSessionUrl(subagentSessionUrl(target))).toEqual(target);
    expect(parseSubagentSessionUrl("https://example.com")).toBeUndefined();
    expect(parseSubagentSessionUrl("pi-action://subagents/session/%ZZ")).toBeUndefined();
  });

  test("links the complete subagent block without replacing nested links", () => {
    const fileLink = "\u001b]8;;file:///tmp/example.ts\u001b\\example.ts\u001b]8;;\u001b\\";
    const url = subagentSessionUrl(target);
    const linked = linkSubagentToolBlock(
      ["▸ Explore  Survey repository context", "└─ Done", fileLink],
      url,
    );

    expect(linked[0]).toContain(url);
    expect(linked[1]).toContain(url);
    expect(linked[2]).toBe(fileLink);
  });

  test("links subagent tool components by their exact result identity", () => {
    const restoreRender = stubToolRender(["▸ Explore  Survey repository context", "  ⎿  Done"]);
    const uninstall = installSubagentToolLinks();

    const rendered = createToolExecution().render(80);

    expect(rendered.some((line) => line.includes(subagentSessionUrl(target)))).toBeTrue();
    uninstall();
    restoreRender();
  });

  test("replaces and cleans up a legacy tool-render patch after reload", () => {
    const prototype = ToolExecutionComponent.prototype as typeof ToolExecutionComponent.prototype &
      Record<symbol, unknown>;
    const nativeRender = prototype.render;
    const originalRender = (_width: number) => [
      "▸ Explore  Survey repository context",
      "  ⎿  Done",
    ];
    prototype.render = function legacyRender(width: number): string[] {
      return originalRender.call(this, width);
    };
    prototype[toolRenderPatch] = { originalRender };

    const uninstall = installSubagentToolLinks();
    expect(createToolExecution().render(80).join("\n")).toContain(subagentSessionUrl(target));
    uninstall();

    expect(prototype.render).toBe(originalRender);
    prototype.render = nativeRender;
  });

  test("leaves unrelated tool components unchanged", () => {
    const restoreRender = stubToolRender(["▸ read  AGENTS.md", "  ⎿  file contents"]);
    const component = createToolExecution("read");
    const before = component.render(80);
    const uninstall = installSubagentToolLinks();

    expect(component.render(80)).toEqual(before);
    uninstall();
    restoreRender();
  });

  test("dispatches internal links and preserves Pi's external URL handler", () => {
    const opened: string[] = [];
    const openedSessions: SubagentSessionTarget[] = [];
    const tui = {
      mode: "fullscreen",
      openUrl: (url: string) => opened.push(url),
    } as unknown as TUI;

    const uninstall = installSubagentSessionUrlHandler(tui, (session) => {
      openedSessions.push(session);
    });
    const openUrl = (tui as TUI & { openUrl: (url: string) => void }).openUrl;
    openUrl(subagentSessionUrl(target));
    openUrl("https://example.com");

    expect(openedSessions).toEqual([target]);
    expect(opened).toEqual(["https://example.com"]);
    uninstall();
    const restoredOpenUrl = (tui as TUI & { openUrl: (url: string) => void }).openUrl;
    restoredOpenUrl("https://after-uninstall.example.com");
    expect(opened).toEqual(["https://example.com", "https://after-uninstall.example.com"]);
  });

  test("replaces a legacy URL patch after reload", () => {
    const opened: string[] = [];
    const originalOpenUrl = (url: string) => opened.push(url);
    const tui = {
      mode: "fullscreen",
      openUrl: () => {},
      [tuiUrlPatch]: { originalOpenUrl },
    } as unknown as TUI;

    const uninstall = installSubagentSessionUrlHandler(tui, () => opened.push("session"));
    const openUrl = (tui as TUI & { openUrl: (url: string) => void }).openUrl;
    openUrl(subagentSessionUrl(target));
    uninstall();
    (tui as TUI & { openUrl: (url: string) => void }).openUrl("https://example.com");

    expect(opened).toEqual(["session", "https://example.com"]);
  });

  test("selects the clicked session without showing the session picker", async () => {
    const options = [
      "Explore (Survey repository context) · 3 tools · completed · 4.0s",
      "Review (Review changes) · 1 tools · completed · 2.0s",
    ];
    expect(findSubagentSessionOption(target, records, options)).toBe(options[0]);

    let originalSelectCalls = 0;
    const ui = {
      select: async () => {
        originalSelectCalls += 1;
        return undefined;
      },
    } as unknown as ExtensionUIContext;
    const cancel = armDirectSubagentSessionSelection(ui, target, () => records);

    expect(await ui.select("Subagent sessions", options)).toBe(options[0]);
    expect(originalSelectCalls).toBe(0);
    await ui.select("Another selector", options);
    expect(originalSelectCalls).toBe(1);
    cancel();
  });

  test("opens the exact session from an actual fullscreen mouse click", () => {
    const terminal = new TestTerminal();
    const tui = new TuiAltScreen(terminal, false, undefined, { openUrl: () => {} });
    const restoreRender = stubToolRender(["▸ Explore  Survey repository context", "  ⎿  Done"]);
    const uninstallToolLinks = installSubagentToolLinks();
    const openedSessions: SubagentSessionTarget[] = [];
    const uninstallUrlHandler = installSubagentSessionUrlHandler(tui, (session) => {
      openedSessions.push(session);
    });
    const component = createToolExecution();
    const linkedLine = component
      .render(80)
      .findIndex((line) => line.includes(subagentSessionUrl(target)));
    tui.addChild(component);

    try {
      tui.start();
      tui.renderNow();
      terminal.send(`\u001b[<0;2;${linkedLine + 1}M`);
      terminal.send(`\u001b[<0;2;${linkedLine + 1}m`);

      expect(openedSessions).toEqual([target]);
    } finally {
      tui.stop();
      uninstallUrlHandler();
      uninstallToolLinks();
      restoreRender();
    }
  });
});
