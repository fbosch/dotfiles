import { describe, expect, test } from "bun:test";
import { type Terminal, Text, type TUI, TuiAltScreen } from "@earendil-works/pi-tui";
import {
  installSubagentSessionsUrlHandler,
  installSubagentToolTitleLinks,
  isSubagentToolTitle,
  isSubagentToolTitleSource,
  linkSubagentToolBlock,
  SUBAGENT_SESSIONS_URL,
} from "../subagent-session-links";

const agentNames = new Set(["explore", "review"]);
const toolRenderPatch = Symbol.for("dotfiles:pi-subagent-session-tool-links");
const tuiUrlPatch = Symbol.for("dotfiles:pi-subagent-session-url-handler");

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
  test("recognizes only known subagent tool titles", () => {
    expect(isSubagentToolTitle("▸ explore  Survey repository context", agentNames)).toBeTrue();
    expect(isSubagentToolTitle("▸ read  AGENTS.md", agentNames)).toBeFalse();
    expect(isSubagentToolTitleSource("  ▸ explore  Quoted output", agentNames)).toBeFalse();
    expect(isSubagentToolTitleSource("▸ explore  First\nsecond", agentNames)).toBeFalse();
  });

  test("links the complete subagent block without replacing nested links", () => {
    const fileLink = "\u001b]8;;file:///tmp/example.ts\u001b\\example.ts\u001b]8;;\u001b\\";
    const linked = linkSubagentToolBlock(
      ["▸ explore  Survey repository context", "└─ reading files…", fileLink],
      agentNames,
    );

    expect(linked[0]).toContain(SUBAGENT_SESSIONS_URL);
    expect(linked[1]).toContain(SUBAGENT_SESSIONS_URL);
    expect(linked[2]).toBe(fileLink);
  });

  test("links subagent title components rendered by pi-subagents", () => {
    const uninstall = installSubagentToolTitleLinks([...agentNames]);

    const rendered = new Text("▸ explore  Survey repository context", 0, 0).render(80);

    expect(rendered[0]).toContain(SUBAGENT_SESSIONS_URL);
    uninstall();
  });

  test("replaces and cleans up a legacy title-render patch after reload", () => {
    const prototype = Text.prototype as typeof Text.prototype & Record<symbol, unknown>;
    const originalRender = prototype.render;
    prototype.render = function legacyRender(width: number): string[] {
      return originalRender.call(this, width);
    };
    prototype[toolRenderPatch] = { agentNames, originalRender };

    const uninstall = installSubagentToolTitleLinks([...agentNames]);
    expect(new Text("▸ explore  Survey repository context", 0, 0).render(80)[0]).toContain(
      SUBAGENT_SESSIONS_URL,
    );
    uninstall();

    expect(prototype.render).toBe(originalRender);
  });

  test("leaves unrelated tool blocks unchanged", () => {
    const lines = ["▸ read  AGENTS.md", "└─ file contents"];

    expect(linkSubagentToolBlock(lines, agentNames)).toEqual(lines);
  });

  test("dispatches internal links and preserves Pi's external URL handler", () => {
    const opened: string[] = [];
    let sessionPickerOpens = 0;
    const tui = {
      mode: "fullscreen",
      openUrl: (url: string) => opened.push(url),
    } as unknown as TUI;

    const uninstall = installSubagentSessionsUrlHandler(tui, () => {
      sessionPickerOpens += 1;
    });
    const openUrl = (tui as TUI & { openUrl: (url: string) => void }).openUrl;
    openUrl(SUBAGENT_SESSIONS_URL);
    openUrl("https://example.com");

    expect(sessionPickerOpens).toBe(1);
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

    const uninstall = installSubagentSessionsUrlHandler(tui, () => opened.push("sessions"));
    const openUrl = (tui as TUI & { openUrl: (url: string) => void }).openUrl;
    openUrl(SUBAGENT_SESSIONS_URL);
    uninstall();
    (tui as TUI & { openUrl: (url: string) => void }).openUrl("https://example.com");

    expect(opened).toEqual(["sessions", "https://example.com"]);
  });

  test("opens the picker from an actual fullscreen mouse click", () => {
    const terminal = new TestTerminal();
    const tui = new TuiAltScreen(terminal, false, undefined, { openUrl: () => {} });
    const uninstallTitleLinks = installSubagentToolTitleLinks([...agentNames]);
    let sessionPickerOpens = 0;
    const uninstallUrlHandler = installSubagentSessionsUrlHandler(tui, () => {
      sessionPickerOpens += 1;
    });
    tui.addChild(new Text("▸ explore  Survey repository context", 0, 0));

    try {
      tui.start();
      tui.renderNow();
      terminal.send("\u001b[<0;2;1M");
      terminal.send("\u001b[<0;2;1m");

      expect(sessionPickerOpens).toBe(1);
    } finally {
      tui.stop();
      uninstallUrlHandler();
      uninstallTitleLinks();
    }
  });
});
