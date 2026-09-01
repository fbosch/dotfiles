import { describe, expect, test } from "bun:test";
import { Text, type TUI } from "@earendil-works/pi-tui";
import {
  installSubagentSessionsUrlHandler,
  installSubagentToolTitleLinks,
  isSubagentToolTitle,
  isSubagentToolTitleSource,
  linkSubagentToolBlock,
  SUBAGENT_SESSIONS_URL,
} from "../subagent-session-links";

const agentNames = new Set(["explore", "review"]);

describe("subagent session links", () => {
  test("recognizes only known subagent tool titles", () => {
    expect(isSubagentToolTitle("› explore  Survey repository context", agentNames)).toBeTrue();
    expect(isSubagentToolTitle("› read  AGENTS.md", agentNames)).toBeFalse();
    expect(isSubagentToolTitleSource("  › explore  Quoted output", agentNames)).toBeFalse();
    expect(isSubagentToolTitleSource("› explore  First\nsecond", agentNames)).toBeFalse();
  });

  test("links the complete subagent block without replacing nested links", () => {
    const fileLink = "\u001b]8;;file:///tmp/example.ts\u001b\\example.ts\u001b]8;;\u001b\\";
    const linked = linkSubagentToolBlock(
      ["› explore  Survey repository context", "└─ reading files…", fileLink],
      agentNames,
    );

    expect(linked[0]).toContain(SUBAGENT_SESSIONS_URL);
    expect(linked[1]).toContain(SUBAGENT_SESSIONS_URL);
    expect(linked[2]).toBe(fileLink);
  });

  test("links subagent title components rendered by pi-subagents", () => {
    const uninstall = installSubagentToolTitleLinks([...agentNames]);

    const rendered = new Text("› explore  Survey repository context", 0, 0).render(80);

    expect(rendered[0]).toContain(SUBAGENT_SESSIONS_URL);
    uninstall();
  });

  test("leaves unrelated tool blocks unchanged", () => {
    const lines = ["› read  AGENTS.md", "└─ file contents"];

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
});
