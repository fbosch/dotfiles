import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExtensionUIContext,
  type TerminalInputHandler,
  type Theme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  hyperlink,
  type OverlayHandle,
  type Terminal,
  Text,
  type TUI,
  TuiAltScreen,
} from "@earendil-works/pi-tui";
import {
  compactSubagentTranscriptSource,
  installClickableSubagentSessions,
  installSubagentSessionUrlHandler,
  installSubagentTerminalLinkFilter,
  installSubagentToolLinks,
  linkSubagentToolBlock,
  openSubagentSession,
  parseSubagentSessionUrl,
  type SubagentSessionTarget,
  subagentSessionUrl,
} from "../subagent-session-links";
import {
  forgetSubagentTranscriptRecord,
  rememberSubagentTranscriptRecord,
} from "../subagent-transcript-records";
import { installSubagentWidgetFrame } from "../subagent-widget-frame";

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

function createClosingOverlayTui(
  options: { focused?: boolean; onShow?: (component: Component) => void } = {},
) {
  let component: Component | undefined;
  let overlayOptions: Parameters<TUI["showOverlay"]>[1];
  let hidden = false;
  const handle: OverlayHandle = {
    hide: () => {
      hidden = true;
    },
    setHidden: () => {},
    isHidden: () => hidden,
    focus: () => {},
    unfocus: () => {},
    isFocused: () => options.focused ?? true,
  };
  const tui = {
    mode: "fullscreen",
    terminal: { columns: 80, rows: 24 },
    requestRender: () => {},
    showOverlay(nextComponent: Component, nextOptions: Parameters<TUI["showOverlay"]>[1]) {
      component = nextComponent;
      overlayOptions = nextOptions;
      queueMicrotask(() =>
        options.onShow === undefined
          ? nextComponent.handleInput?.("\u001b")
          : options.onShow(nextComponent),
      );
      return handle;
    },
  } as unknown as TUI;

  return {
    tui,
    getComponent: () => component,
    getOptions: () => overlayOptions,
    isHidden: () => hidden,
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

  test("colorizes inline subagent tool headers from agent metadata", () => {
    const color = "\u001b[38;2;91;155;213m";
    const tui = {} as TUI;
    const restoreRender = stubToolRender([
      "▸ lookup  Look up Worktrunk Pi plugin",
      "  ⎿  thinking…",
    ]);
    const uninstall = installSubagentToolLinks(tui, undefined, {
      theme: { getColorMode: () => "truecolor" } as unknown as Theme,
      agentColors: new Map([["lookup", "#5B9BD5"]]),
    });

    try {
      const rendered = createToolExecution("subagent", target.agentId, tui).render(80);

      expect(rendered[0]).toContain(`${color}lookup\u001b[39m`);
      expect(rendered[1]).not.toContain(color);
    } finally {
      uninstall();
      restoreRender();
    }
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

  test("bounds tool output even when the transcript requests expanded rendering", () => {
    const source = compactSubagentTranscriptSource({
      getMessages: () => [],
      subscribe: () => undefined,
      streaming: () => undefined,
      getToolDefinition: () => undefined,
    });
    const definition = source.getToolDefinition("read");
    const renderResult = definition?.renderResult;
    if (renderResult === undefined) throw new Error("Missing compact transcript renderer");

    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    } as Theme;
    const context: Parameters<typeof renderResult>[3] = {
      args: {},
      toolCallId: "tool-call-1",
      invalidate: () => {},
      lastComponent: undefined,
      state: {},
      cwd: process.cwd(),
      executionStarted: true,
      argsComplete: true,
      isPartial: false,
      expanded: true,
      showImages: false,
      isError: false,
    };
    const output = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n");

    const rendered = renderResult(
      { content: [{ type: "text", text: output }], details: {} },
      { expanded: true, isPartial: false },
      theme,
      context,
    )
      .render(80)
      .join("\n");

    expect(rendered).toContain("line 5");
    expect(rendered).not.toContain("line 6");
    expect(rendered).toContain("... (3 more lines)");
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
    const overlay = createClosingOverlayTui();
    const notifications: Array<[string, string]> = [];
    let customPromptCalls = 0;
    const ui = {
      theme: {} as Theme,
      custom: async () => {
        customPromptCalls += 1;
        return undefined;
      },
      notify: (message: string, level: string) => notifications.push([message, level]),
    };
    const ctx = { ui, cwd: process.cwd() } as unknown as Parameters<typeof openSubagentSession>[2];

    try {
      await openSubagentSession(target, service, ctx, overlay.tui);

      expect(requestedIds).toEqual([target.agentId]);
      expect(typeof overlay.getComponent()?.render).toBe("function");
      expect(overlay.getOptions()).toEqual({
        anchor: "center",
        width: "90%",
        maxHeight: "70%",
      });
      expect(overlay.isHidden()).toBe(true);
      expect(customPromptCalls).toBe(0);
      expect(notifications).toEqual([
        ["Opening the current transcript snapshot. Reopen it to refresh.", "info"],
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("closes the transcript before a non-overlay prompt can consume Escape", async () => {
    const liveRecord = {
      id: target.agentId,
      status: "running",
      agentMessages: [],
      activeTools: new Map<string, string>(),
      responseText: "",
      isSessionReady: () => true,
      subscribeToUpdates: () => () => {},
      getToolDefinition: () => undefined,
    };
    const service = {
      getRecord: () => ({ status: "running" }),
      manager: {
        getRecord: () => liveRecord,
        listAgents: () => [liveRecord],
      },
    };
    let terminalInputHandler: TerminalInputHandler | undefined;
    let inputHandlerRemoved = false;
    const overlay = createClosingOverlayTui({
      focused: false,
      onShow: () => {
        expect(terminalInputHandler?.("\u001b")).toEqual({ consume: true });
      },
    });
    const ui = {
      theme: {} as Theme,
      onTerminalInput: (handler: TerminalInputHandler) => {
        terminalInputHandler = handler;
        return () => {
          inputHandlerRemoved = true;
          terminalInputHandler = undefined;
        };
      },
      notify: () => {},
    };
    const ctx = { ui, cwd: process.cwd() } as unknown as Parameters<typeof openSubagentSession>[2];

    await openSubagentSession(target, service, ctx, overlay.tui);

    expect(overlay.isHidden()).toBe(true);
    expect(inputHandlerRemoved).toBe(true);
  });

  test("opens a ready running session with live transcript updates", async () => {
    let subscriptions = 0;
    let unsubscriptions = 0;
    const liveRecord = {
      id: target.agentId,
      status: "running",
      agentMessages: [],
      activeTools: new Map<string, string>(),
      responseText: "",
      isSessionReady: () => true,
      subscribeToUpdates: () => {
        subscriptions += 1;
        return () => {
          unsubscriptions += 1;
        };
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
    const overlay = createClosingOverlayTui();
    const notifications: string[] = [];
    const ui = {
      theme: {} as Theme,
      notify: (message: string) => notifications.push(message),
    };
    const ctx = { ui, cwd: process.cwd() } as unknown as Parameters<typeof openSubagentSession>[2];

    await openSubagentSession(target, service, ctx, overlay.tui);

    expect(subscriptions).toBe(1);
    expect(unsubscriptions).toBe(1);
    expect(overlay.isHidden()).toBe(true);
    expect(notifications).toEqual([]);
  });

  test("aborts and disposes a mounted transcript during session cleanup", async () => {
    let resolveMounted = () => {};
    const mounted = new Promise<void>((resolve) => {
      resolveMounted = resolve;
    });
    let unsubscriptions = 0;
    const liveRecord = {
      id: target.agentId,
      status: "running",
      agentMessages: [],
      activeTools: new Map<string, string>(),
      responseText: "",
      isSessionReady: () => true,
      subscribeToUpdates: () => () => {
        unsubscriptions += 1;
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
    const overlay = createClosingOverlayTui({ onShow: resolveMounted });
    const ctx = {
      ui: { theme: {} as Theme, notify: () => {} },
      cwd: process.cwd(),
    } as unknown as Parameters<typeof openSubagentSession>[2];
    const abortController = new AbortController();

    const opening = openSubagentSession(target, service, ctx, overlay.tui, abortController.signal);
    await mounted;
    abortController.abort();
    await opening;

    expect(overlay.isHidden()).toBe(true);
    expect(unsubscriptions).toBe(1);
  });

  test("opens a widget transcript snapshot after the publishing service is replaced", async () => {
    const directory = mkdtempSync(join(tmpdir(), "stale-subagent-session-"));
    const outputFile = join(directory, "session.jsonl");
    const sessionId = "parent-session-123";
    const staleTarget = {
      agentId: "stale-agent-123",
      displayName: "explore",
      description: "Inspect stale service handling",
    };
    writeFileSync(
      outputFile,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "child-session-456",
        timestamp: "2026-09-03T00:00:00.000Z",
        cwd: process.cwd(),
        parentSession: sessionId,
      })}\n`,
    );
    const staleRecord = {
      id: staleTarget.agentId,
      type: staleTarget.displayName,
      description: staleTarget.description,
      status: "running",
      isBackground: true,
      outputFile,
    };
    let widgetFactory: ((tui: TUI, theme: Theme) => Component) | undefined;
    const widgetUi = {
      setWidget(_key: string, content: typeof widgetFactory): void {
        widgetFactory = content;
      },
    } as unknown as ExtensionUIContext;
    const uninstallWidgetFrame = installSubagentWidgetFrame(widgetUi, {
      getSubagents: () => [staleRecord],
      sessionId,
    });
    widgetUi.setWidget("agents", () => ({
      render: () => [
        "● Agents",
        "└─ ⠋ explore  Inspect stale service handling · 1 tool use · 2.0s",
        "     ⎿  thinking…",
      ],
      invalidate: () => {},
    }));
    const overlay = createClosingOverlayTui();
    const notifications: Array<[string, string]> = [];
    const ctx = {
      cwd: process.cwd(),
      sessionManager: { getSessionId: () => sessionId },
      ui: {
        theme: {} as Theme,
        notify: (message: string, level: string) => notifications.push([message, level]),
      },
    } as unknown as Parameters<typeof openSubagentSession>[2];

    try {
      if (widgetFactory === undefined) throw new Error("Expected a widget factory");
      widgetFactory(overlay.tui, {
        fg: (_color: string, text: string) => text,
        getBgAnsi: () => "",
      } as unknown as Theme).render(80);

      await openSubagentSession(staleTarget, { getRecord: () => undefined }, ctx, overlay.tui);

      expect(typeof overlay.getComponent()?.render).toBe("function");
      expect(overlay.isHidden()).toBe(true);
      expect(notifications).toEqual([
        ["Opening the current transcript snapshot. Reopen it to refresh.", "info"],
      ]);
    } finally {
      uninstallWidgetFrame();
      forgetSubagentTranscriptRecord(sessionId, staleTarget.agentId);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects a cached transcript from another parent session", async () => {
    const directory = mkdtempSync(join(tmpdir(), "wrong-parent-subagent-session-"));
    const outputFile = join(directory, "session.jsonl");
    const sessionId = "expected-parent-session";
    const agentId = "wrong-parent-agent";
    writeFileSync(
      outputFile,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "child-session",
        timestamp: "2026-09-03T00:00:00.000Z",
        cwd: process.cwd(),
        parentSession: "different-parent-session",
      })}\n`,
    );
    rememberSubagentTranscriptRecord(sessionId, {
      id: agentId,
      status: "completed",
      outputFile,
    });
    const overlay = createClosingOverlayTui();
    const notifications: Array<[string, string]> = [];
    const ctx = {
      cwd: process.cwd(),
      sessionManager: { getSessionId: () => sessionId },
      ui: {
        theme: {} as Theme,
        notify: (message: string, level: string) => notifications.push([message, level]),
      },
    } as unknown as Parameters<typeof openSubagentSession>[2];

    try {
      await openSubagentSession(
        { agentId, displayName: "explore", description: "Wrong parent" },
        { getRecord: () => undefined },
        ctx,
        overlay.tui,
      );

      expect(overlay.getComponent()).toBeUndefined();
      expect(notifications).toEqual([["Could not read the selected subagent session.", "error"]]);
    } finally {
      forgetSubagentTranscriptRecord(sessionId, agentId);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("distinguishes missing sessions from sessions that are not ready", async () => {
    const notifications: string[] = [];
    const ctx = {
      ui: {
        notify: (message: string) => notifications.push(message),
      },
      cwd: process.cwd(),
    } as unknown as Parameters<typeof openSubagentSession>[2];

    const tui = {} as TUI;
    await openSubagentSession(target, { getRecord: () => undefined }, ctx, tui);
    await openSubagentSession(target, { getRecord: () => ({ status: "queued" }) }, ctx, tui);

    expect(notifications).toEqual([
      "The selected subagent session is no longer available.",
      "The selected subagent session is not ready yet.",
    ]);
  });

  test("resolves a service published after the click handler is installed", async () => {
    const serviceKey = Symbol.for("@gotgenes/pi-subagents:service");
    const globals = globalThis as Record<symbol, unknown>;
    const previousService = globals[serviceKey];
    delete globals[serviceKey];
    const terminal = new TestTerminal();
    const tui = new TuiAltScreen(terminal, false, undefined, { openUrl: () => {} });
    const notifications: Array<[string, string]> = [];
    const ctx = {
      cwd: process.cwd(),
      ui: {
        theme: {} as Theme,
        notify: (message: string, level: string) => notifications.push([message, level]),
      },
    } as unknown as Parameters<typeof installClickableSubagentSessions>[1];
    const uninstall = installClickableSubagentSessions(tui, ctx);
    globals[serviceKey] = {
      getRecord: () => undefined,
      listAgents: () => [],
    };

    try {
      (tui as unknown as TUI & { openUrl: (url: string) => void }).openUrl(
        subagentSessionUrl(target),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(notifications).toEqual([
        ["The selected subagent session is no longer available.", "warning"],
      ]);
    } finally {
      uninstall();
      if (previousService === undefined) delete globals[serviceKey];
      else globals[serviceKey] = previousService;
    }
  });

  test("uses the captured service after its global publication is removed", async () => {
    const serviceKey = Symbol.for("@gotgenes/pi-subagents:service");
    const globals = globalThis as Record<symbol, unknown>;
    const previousService = globals[serviceKey];
    let recordLookups = 0;
    globals[serviceKey] = {
      getRecord: () => {
        recordLookups += 1;
        return undefined;
      },
      listAgents: () => [],
    };
    const terminal = new TestTerminal();
    const tui = new TuiAltScreen(terminal, false, undefined, { openUrl: () => {} });
    const notifications: Array<[string, string]> = [];
    const ctx = {
      cwd: process.cwd(),
      ui: {
        theme: {} as Theme,
        notify: (message: string, level: string) => notifications.push([message, level]),
      },
    } as unknown as Parameters<typeof installClickableSubagentSessions>[1];
    const uninstall = installClickableSubagentSessions(tui, ctx);
    delete globals[serviceKey];

    try {
      (tui as unknown as TUI & { openUrl: (url: string) => void }).openUrl(
        subagentSessionUrl(target),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(recordLookups).toBeGreaterThan(0);
      expect(notifications).toEqual([
        ["The selected subagent session is no longer available.", "warning"],
      ]);
    } finally {
      uninstall();
      if (previousService === undefined) delete globals[serviceKey];
      else globals[serviceKey] = previousService;
    }
  });

  test("serializes transcript clicks and closes the active overlay on disposal", async () => {
    const directory = mkdtempSync(join(tmpdir(), "subagent-session-disposal-"));
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
    const serviceKey = Symbol.for("@gotgenes/pi-subagents:service");
    const globals = globalThis as Record<symbol, unknown>;
    const previousService = globals[serviceKey];
    globals[serviceKey] = {
      getRecord: () => ({ outputFile, status: "running" }),
      listAgents: () => [],
    };
    const terminal = new TestTerminal();
    const tui = new TuiAltScreen(terminal, false, undefined, { openUrl: () => {} });
    let mountCount = 0;
    const originalShowOverlay = tui.showOverlay.bind(tui);
    tui.showOverlay = (component, options) => {
      mountCount += 1;
      return originalShowOverlay(component, options);
    };
    const ctx = {
      cwd: process.cwd(),
      ui: { theme: {} as Theme, notify: () => {} },
    } as unknown as Parameters<typeof installClickableSubagentSessions>[1];
    const uninstall = installClickableSubagentSessions(tui, ctx);
    const openUrl = (tui as unknown as TUI & { openUrl: (url: string) => void }).openUrl;

    try {
      openUrl(subagentSessionUrl(target));
      openUrl(subagentSessionUrl(target));
      for (let attempt = 0; attempt < 100 && mountCount === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      expect(mountCount).toBe(1);
      expect(tui.hasOverlay()).toBe(true);
      uninstall();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(tui.hasOverlay()).toBe(false);
      expect(mountCount).toBe(1);
    } finally {
      uninstall();
      rmSync(directory, { recursive: true, force: true });
      if (previousService === undefined) delete globals[serviceKey];
      else globals[serviceKey] = previousService;
    }
  });

  test("opens a service-spawned session from an actual widget click", () => {
    const terminal = new TestTerminal();
    const tui = new TuiAltScreen(terminal, false, undefined, { openUrl: () => {} });
    const widgetTarget: SubagentSessionTarget = {
      agentId: "agent-1",
      displayName: "general",
      description: "Create an ADR",
    };
    let widgetFactory: ((tui: TUI, theme: Theme) => Component) | undefined;
    const widgetUi = {
      setWidget(_key: string, content: undefined | ((tui: TUI, theme: Theme) => Component)): void {
        widgetFactory = content;
      },
    } as unknown as ExtensionUIContext;
    const uninstallWidgetFrame = installSubagentWidgetFrame(widgetUi, {
      agentColors: new Map(),
      agentDisplayNames: new Map([["general", "general"]]),
      getSubagents: () => [
        {
          id: widgetTarget.agentId,
          type: "general",
          description: widgetTarget.description,
          status: "running",
          isBackground: true,
        },
      ],
    });
    widgetUi.setWidget("agents", () => ({
      render: () => [
        "● Agents",
        "└─ ⠋ general (twin)  Create an ADR · 3 turns · 1.2s",
        "     ⎿  thinking…",
      ],
      invalidate: () => {},
    }));
    if (widgetFactory === undefined) throw new Error("Expected a widget factory");
    const component = widgetFactory(tui, {
      fg: (_color: string, text: string) => text,
      getBgAnsi: () => "\u001b[48;2;34;34;34m",
      getColorMode: () => "truecolor",
    } as unknown as Theme);
    const openedSessions: SubagentSessionTarget[] = [];
    const uninstallUrlHandler = installSubagentSessionUrlHandler(tui, (session) => {
      openedSessions.push(session);
    });
    const uninstallTerminalFilter = installSubagentTerminalLinkFilter(tui);
    const linkedLines = component
      .render(80)
      .flatMap((line, index) => (line.includes(subagentSessionUrl(widgetTarget)) ? [index] : []));
    const linkedLine = linkedLines.at(-1) ?? -1;
    tui.addChild(component);

    try {
      tui.start();
      tui.renderNow();
      expect(linkedLines).toHaveLength(2);
      expect(linkedLine).toBeGreaterThan(-1);
      expect(terminal.output).not.toContain(subagentSessionUrl(widgetTarget));
      terminal.send(`\u001b[<0;4;${linkedLine + 1}M`);
      terminal.send(`\u001b[<0;4;${linkedLine + 1}m`);

      expect(openedSessions).toEqual([widgetTarget]);
    } finally {
      tui.stop();
      uninstallTerminalFilter();
      uninstallUrlHandler();
      uninstallWidgetFrame();
    }
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
