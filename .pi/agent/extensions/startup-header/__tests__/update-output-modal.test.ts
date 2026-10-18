import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";
import { UpdateOutputModal } from "../update-output-modal";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

function createTui(): TUI {
  return {
    terminal: { columns: 100, rows: 40 },
    requestRender: () => {},
  } as unknown as TUI;
}

describe("update output modal", () => {
  test("shows captured package output and waits for dismissal after completion", () => {
    let dismissals = 0;
    const modal = new UpdateOutputModal(createTui(), theme, 2, () => dismissals++);
    modal.appendOutput("stdout", "npm install output\n");
    modal.appendOutput("stderr", "lifecycle script output\n");

    const duringUpdate = stripTerminalSequences(modal.render(80).join("\n"));
    expect(duringUpdate).toContain("npm install output");
    expect(duringUpdate).toContain("lifecycle script output");
    expect(duringUpdate).toContain("Updating 2 packages");
    modal.handleInput("\x1b");
    expect(dismissals).toBe(0);

    modal.finish({ updated: 1, failed: ["@acme/tool"], cancelled: false });
    const completed = stripTerminalSequences(modal.render(80).join("\n"));
    expect(completed).toContain("Updated 1 of 2; failed: @acme/tool");
    modal.handleInput("\r");
    expect(dismissals).toBe(1);
  });

  test("shows a bounded tail when output exceeds the display buffer", () => {
    const modal = new UpdateOutputModal(createTui(), theme, 1, () => {});
    modal.appendOutput("stdout", "x".repeat(250_100));

    modal.finish({ updated: 1, failed: [], cancelled: false });
    modal.render(80);
    modal.handleInput("\x1b[H");
    const rendered = stripTerminalSequences(modal.render(80).join("\n"));
    expect(rendered).toContain("[Earlier output omitted]");
  });
});
