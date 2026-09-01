import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExtensionUIContext,
  type KeybindingsManager,
  type Theme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  hyperlink,
  type Terminal,
  Text,
  type TUI,
  TuiAltScreen,
} from "@earendil-works/pi-tui";
import {
  installSubagentSessionUrlHandler,
  installSubagentTerminalLinkFilter,
  installSubagentToolLinks,
  linkSubagentToolBlock,
  openSubagentSession,
  parseSubagentSessionUrl,
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
function createToolExecution(
  toolName = "subagent",
  agentId: string | null = target.agentId,
  tui?: TUI,
): ToolExecutionComponent {
  return Object.assign(Object.create(ToolExecutionComponent.prototype), {
    toolName,
    toolCallId: "tool-call-1",
    ...(tui === undefined ? {} : { ui: tui }),
    result: {
      details: {
        ...(agentId === null ? {} : { agentId }),
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
  readonly writes: string[] = [];
  private onInput: ((data: string) => void) | undefined;

  get output(): string {
    return this.writes.join("");
  }

  start(onInput: (data: string) => void): void {
    this.onInput = onInput;
  }

  send(data: string): void {
    this.onInput?.(data);
  }

  stop(): void {}
  async drainInput(): Promise<void> {}
  write(data: string): void {
    this.writes.push(data);
  }
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
    expect(parseSubagentSessionUrl(subagentSessionUrl({ ...target, agentId: ".." }))).toEqual({
      ...target,
      agentId: "..",
    });
    expect(parseSubagentSessionUrl("https://example.com")).toBeUndefined();
    expect(parseSubagentSessionUrl("pi-action://subagents/session/%ZZ")).toBeUndefined();
    expect(
      parseSubagentSessionUrl(
        "pi-action://subagents/session?id=%ZZ&name=Explore&description=Survey",
      ),
    ).toBeUndefined();
    expect(
      parseSubagentSessionUrl(
        "pi-action://evil@subagents/session?id=one&name=Explore&description=Survey",
      ),
    ).toBeUndefined();
    expect(
      parseSubagentSessionUrl(
        "pi-action://subagents/session?id=one&id=two&name=Explore&description=Survey",
      ),
    ).toBeUndefined();
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

  test("links a running subagent through its originating tool call", () => {
    const serviceKey = Symbol.for("@gotgenes/pi-subagents:service");
    const globals = globalThis as Record<symbol, unknown>;
    const previousService = globals[serviceKey];
    const parentService = {
      manager: {
        listAgents: () => [{ id: target.agentId, toolCallId: "tool-call-1" }],
      },
    };
    const parentTui = {} as TUI;
    const restoreRender = stubToolRender([
      "▸ Explore  Survey repository context",
      "  ⎿  thinking…",
    ]);
    const uninstall = installSubagentToolLinks(
      parentTui,
      parentService as Parameters<typeof installSubagentToolLinks>[1],
    );
    globals[serviceKey] = { manager: { listAgents: () => [] } };

    try {
      expect(createToolExecution("subagent", null, parentTui).render(80).join("\n")).toContain(
        subagentSessionUrl(target),
      );
    } finally {
      uninstall();
      restoreRender();
      if (previousService === undefined) delete globals[serviceKey];
      else globals[serviceKey] = previousService;
    }
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

  test("removes the previous Text prototype patch after reload", () => {
    const prototype = Text.prototype as typeof Text.prototype & Record<symbol, unknown>;
    const originalRender = prototype.render;
    prototype.render = function legacyRender(width: number): string[] {
      return originalRender.call(this, width);
    };
    prototype[toolRenderPatch] = { version: 1, originalRender };

    const uninstall = installSubagentToolLinks();

    expect(prototype.render).toBe(originalRender);
    expect(prototype[toolRenderPatch]).toBeUndefined();
    uninstall();
  });

  test("does not clear a newer tool-render patch during stale cleanup", () => {
    const prototype = ToolExecutionComponent.prototype as typeof ToolExecutionComponent.prototype &
      Record<symbol, unknown>;
    const originalRender = prototype.render;
    const uninstall = installSubagentToolLinks();
    const newerRender = () => ["newer"];
    const newerState = { version: 999 };
    prototype.render = newerRender;
    prototype[toolRenderPatch] = newerState;

    uninstall();

    expect(prototype.render).toBe(newerRender);
    expect(prototype[toolRenderPatch]).toBe(newerState);
    prototype.render = originalRender;
    prototype[toolRenderPatch] = undefined;
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

  test("hides only internal links from the terminal and restores writes on uninstall", () => {
    const terminal = new TestTerminal();
    const tui = new TuiAltScreen(terminal, false, undefined, { openUrl: () => {} });
    const internalUrl = subagentSessionUrl(target);
    const externalUrl = "https://example.com";
    const uninstall = installSubagentTerminalLinkFilter(tui);

    terminal.write(`${hyperlink("session", internalUrl)} ${hyperlink("external", externalUrl)}`);

    expect(terminal.output).toContain("session");
    expect(terminal.output).not.toContain(internalUrl);
    expect(terminal.output).toContain(externalUrl);

    uninstall();
    terminal.writes.length = 0;
    terminal.write(hyperlink("session", internalUrl));
    expect(terminal.output).toContain(internalUrl);
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

  test("restores the previous URL handler when a newer installation is disposed", () => {
    const calls: string[] = [];
    const tui = { mode: "fullscreen", openUrl: () => {} } as unknown as TUI;
    const uninstallFirst = installSubagentSessionUrlHandler(tui, () => calls.push("first"));
    const uninstallSecond = installSubagentSessionUrlHandler(tui, () => calls.push("second"));
    const openUrl = (tui as TUI & { openUrl: (url: string) => void }).openUrl;

    openUrl(subagentSessionUrl(target));
    uninstallSecond();
    openUrl(subagentSessionUrl(target));
    uninstallFirst();

    expect(calls).toEqual(["second", "first"]);
  });

  test("does not clear a newer URL patch during stale cleanup", () => {
    const tui = { mode: "fullscreen", openUrl: () => {} } as unknown as TUI;
    const patchableTui = tui as TUI & Record<symbol, unknown> & { openUrl: (url: string) => void };
    const uninstall = installSubagentSessionUrlHandler(tui, () => {});
    const newerOpenUrl = () => {};
    const newerState = { version: 999 };
    patchableTui.openUrl = newerOpenUrl;
    patchableTui[tuiUrlPatch] = newerState;

    uninstall();

    expect(patchableTui.openUrl).toBe(newerOpenUrl);
    expect(patchableTui[tuiUrlPatch]).toBe(newerState);
  });

  test("opens the clicked transcript directly without invoking a picker", async () => {
    const directory = mkdtempSync(join(tmpdir(), "subagent-session-links-"));
    const outputFile = join(directory, "session.jsonl");
    writeFileSync(
      outputFile,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: target.agentId,
        timestamp: "2026-09-01T00:00:00.000Z",
        cwd: process.cwd(),
      })}\n`,
    );
    const requestedIds: string[] = [];
    const service = {
      getRecord: (id: string) => {
        requestedIds.push(id);
        return { outputFile, status: "running" };
      },
    };
    let overlay: Component | undefined;
    let overlayOptions: unknown;
    const notifications: Array<[string, string]> = [];
    const ui = {
      custom: async (
        factory: Parameters<ExtensionUIContext["custom"]>[0],
        options?: Parameters<ExtensionUIContext["custom"]>[1],
      ) => {
        overlayOptions = options;
        overlay = await factory(
          {
            terminal: { columns: 80, rows: 24 },
            requestRender: () => {},
          } as unknown as TUI,
          {} as Theme,
          {} as KeybindingsManager,
          () => {},
        );
        return undefined;
      },
      notify: (message: string, level: string) => notifications.push([message, level]),
    };
    const ctx = { ui, cwd: process.cwd() } as unknown as Parameters<typeof openSubagentSession>[2];

    try {
      await openSubagentSession(target, service, ctx);

      expect(requestedIds).toEqual([target.agentId]);
      expect(typeof overlay?.render).toBe("function");
      expect(overlayOptions).toEqual({
        overlay: true,
        overlayOptions: { anchor: "center", width: "90%", maxHeight: "70%" },
      });
      expect(notifications).toEqual([
        ["Opening the current transcript snapshot. Reopen it to refresh.", "info"],
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("opens a ready running session with live transcript updates", async () => {
    let subscriptions = 0;
    const liveRecord = {
      id: target.agentId,
      status: "running",
      agentMessages: [],
      activeTools: new Map<string, string>(),
      responseText: "",
      isSessionReady: () => true,
      subscribeToUpdates: () => {
        subscriptions += 1;
        return () => {};
      },
      getToolDefinition: () => undefined,
    };
    const service = {
      getRecord: () => ({ status: "running" }),
      manager: {
        getRecord: () => liveRecord,
        listAgents: () => [liveRecord],
      },
    };
    const notifications: string[] = [];
    const ui = {
      custom: async (factory: Parameters<ExtensionUIContext["custom"]>[0]) => {
        await factory(
          {
            terminal: { columns: 80, rows: 24 },
            requestRender: () => {},
          } as unknown as TUI,
          {} as Theme,
          {} as KeybindingsManager,
          () => {},
        );
        return undefined;
      },
      notify: (message: string) => notifications.push(message),
    };
    const ctx = { ui, cwd: process.cwd() } as unknown as Parameters<typeof openSubagentSession>[2];

    await openSubagentSession(target, service, ctx);

    expect(subscriptions).toBe(1);
    expect(notifications).toEqual([]);
  });

  test("distinguishes missing sessions from sessions that are not ready", async () => {
    const notifications: string[] = [];
    const ctx = {
      ui: {
        notify: (message: string) => notifications.push(message),
      },
      cwd: process.cwd(),
    } as unknown as Parameters<typeof openSubagentSession>[2];

    await openSubagentSession(target, { getRecord: () => undefined }, ctx);
    await openSubagentSession(target, { getRecord: () => ({ status: "queued" }) }, ctx);

    expect(notifications).toEqual([
      "The selected subagent session is no longer available.",
      "The selected subagent session is not ready yet.",
    ]);
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
    const uninstallTerminalFilter = installSubagentTerminalLinkFilter(tui);
    const component = createToolExecution();
    const linkedLine = component
      .render(80)
      .findIndex((line) => line.includes(subagentSessionUrl(target)));
    tui.addChild(component);

    try {
      tui.start();
      tui.renderNow();
      expect(terminal.output).not.toContain(subagentSessionUrl(target));
      terminal.send(`\u001b[<0;2;${linkedLine + 1}M`);
      terminal.send(`\u001b[<0;2;${linkedLine + 1}m`);

      expect(openedSessions).toEqual([target]);
    } finally {
      tui.stop();
      uninstallTerminalFilter();
      uninstallUrlHandler();
      uninstallToolLinks();
      restoreRender();
    }
  });
});
