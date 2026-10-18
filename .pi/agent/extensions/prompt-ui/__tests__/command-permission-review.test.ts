import { describe, expect, test } from "bun:test";
import type { ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";
import { inspectCommand } from "../../semantic-command-guard/inspection";
import { confirmCommandPermission } from "../command-permission";

const plain = (component: Component, width = 100) =>
  component
    .render(width)
    .map((line) => stripTerminalSequences(line).trimEnd())
    .join("\n");

async function review(
  command: string,
  act: (component: Component, terminal: { rows: number }) => void | Promise<void>,
  copy: (text: string) => Promise<void> = async () => {},
) {
  const terminal = { rows: 24 };
  const inspection = inspectCommand(command);
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      custom: async (factory: Parameters<ExtensionContext["ui"]["custom"]>[0]) => {
        let result: unknown;
        let completed = false;
        const component = await factory(
          { terminal, requestRender() {} } as unknown as TUI,
          {
            fg: (_color: string, text: string) => text,
            bg: (_color: string, text: string) => text,
            inverse: (text: string) => text,
          } as unknown as Theme,
          {} as KeybindingsManager,
          (value) => {
            completed = true;
            result = value;
          },
        );
        await act(component, terminal);
        expect(completed).toBe(false);
        component.handleInput?.("\u001b");
        component.dispose?.();
        return result;
      },
    },
  } as unknown as ExtensionContext;
  return confirmCommandPermission(
    ctx,
    {
      command,
      cwd: "/workspace",
      risks: ["destructive changes"],
      evidence: inspection.kind === "review" ? inspection.evidence : [],
      signal: new AbortController().signal,
    },
    copy,
  );
}

describe("command consent review", () => {
  test("keeps actions visible while scrolling to the last byte of a large payload", async () => {
    const command = `cd src && printf '%s' 'await rm(directory); ${"payload ".repeat(1300)}FINAL_TARGET' > test.ts`;
    expect(
      await review(command, (component, terminal) => {
        expect(component.render(100).length).toBeLessThanOrEqual(terminal.rows);
        expect(plain(component)).toContain("Run command");
        expect(plain(component)).toContain("Cancel");
        expect(plain(component)).toContain("PgUp/PgDn");
        const initial = plain(component);
        component.handleInput?.("\u001b[6~");
        expect(plain(component)).not.toBe(initial);
        component.handleInput?.("\u001b[5~");
        expect(plain(component)).toBe(initial);
        component.handleInput?.("\u001b[F");
        expect(plain(component)).toContain("FINAL_TARGET");
        expect(plain(component)).toContain("Run command");
        terminal.rows = 18;
        expect(component.render(60).length).toBeLessThanOrEqual(terminal.rows);
        component.handleInput?.("\u001b[H");
        expect(plain(component, 60)).toContain("Why flagged");
      }),
    ).toBe(false);
  });

  test("preserves real newlines without turning literal backslash-n into a newline", async () => {
    await review("printf '%s' 'first\nsecond\\nthird' > out; rm out", (component) => {
      const text = plain(component);
      expect(text).toContain("first\n");
      expect(text).toContain("second\\nthird");
      expect(text).not.toContain("Command (escaped)");
    });
  });

  test("explains quoted operation-name matches without claiming they execute", async () => {
    const command = "cd src && printf '%s' 'await rm(directory, { recursive: true });' > test.ts";
    await review(command, (component) => {
      const text = plain(component);
      expect(text).toContain('Operation name: "rm" (line 1, column 30)');
      expect(text).toContain("Quoted data and comments can trigger warnings.");
      expect(text).toContain("Targets and effects are not resolved.");
    });
  });

  test("copies the unchanged command only after the copy shortcut", async () => {
    const command = "printf '%s' 'træer\nø å\\n\t\u001b' > out; rm out";
    const copies: string[] = [];
    await review(
      command,
      async (component) => {
        expect(copies).toEqual([]);
        component.render(100);
        component.handleInput?.("\u0019");
        await Promise.resolve();
        expect(copies).toEqual([command]);
        expect(plain(component)).toContain("Command copied");
      },
      async (text) => {
        copies.push(text);
      },
    );
  });

  test("reports a copy failure without approving or closing the review", async () => {
    await review(
      "rm -rf ./src",
      async (component) => {
        component.render(100);
        component.handleInput?.("\u0019");
        await Promise.resolve();
        expect(plain(component)).toContain("Unable to copy command.");
        expect(plain(component)).toContain("Cancel");
      },
      async () => {
        throw new Error("Clipboard unavailable");
      },
    );
  });
});
