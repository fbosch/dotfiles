import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  type FileBaseline,
  formatChangesStatus,
  summarizeFileChange,
  type TrackedFile,
} from "../model";
import { FileChangesWidget, renderChangeRows } from "../widget";

const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
  getBgAnsi: () => "",
} as unknown as Theme;

function baseline(originalContent: string | null): FileBaseline {
  return {
    path: "src/example.ts",
    absolutePath: "/repo/src/example.ts",
    originalContent,
  };
}

describe("file change model", () => {
  test("counts cumulative replacements against the first baseline", () => {
    expect(summarizeFileChange(baseline("one\ntwo\n"), "one\nthree\n")).toEqual({
      path: "src/example.ts",
      kind: "modified",
      added: 1,
      removed: 1,
    });
  });

  test("counts hunk lines that resemble patch headers", () => {
    expect(summarizeFileChange(baseline("-- removed\n"), "++ added\n")).toMatchObject({
      added: 1,
      removed: 1,
    });
  });

  test("tracks new empty files and removes files restored to baseline", () => {
    expect(summarizeFileChange(baseline(null), "")).toEqual({
      path: "src/example.ts",
      kind: "added",
      added: 0,
      removed: 0,
    });
    expect(summarizeFileChange(baseline("same\n"), "same\n")).toBeUndefined();
    expect(summarizeFileChange(baseline(null), null)).toBeUndefined();
  });

  test("formats one compact footer status", () => {
    const changes: TrackedFile[] = [
      { path: "a.ts", kind: "added", added: 3, removed: 0 },
      { path: "b.ts", kind: "modified", added: 1, removed: 2 },
    ];

    expect(formatChangesStatus(changes)).toBe("2 files +4 -2");
    expect(formatChangesStatus([])).toBeUndefined();
  });
});

describe("file changes widget", () => {
  test("sorts porcelain rows and preserves the end of long paths", () => {
    const changes: TrackedFile[] = [
      { path: "z.ts", kind: "added", added: 2, removed: 0 },
      {
        path: "a/very/long/path/to/important-file.ts",
        kind: "modified",
        added: 1,
        removed: 1,
      },
    ];
    const rows = renderChangeRows(changes, theme, 30, false).map(stripTerminalSequences);

    expect(rows[0]).toStartWith(" M …");
    expect(rows[0]).toContain("important-file.ts");
    expect(rows[0]).toContain("+1 -1");
    expect(rows[1]).toContain("?? z.ts");
  });

  test("colors statuses and line counts semantically", () => {
    const colors: Array<[string, string]> = [];
    const recordingTheme = {
      fg: (color: string, text: string) => {
        colors.push([color, text]);
        return text;
      },
    };
    renderChangeRows(
      [
        { path: "added.ts", kind: "added", added: 2, removed: 0 },
        { path: "modified.ts", kind: "modified", added: 0, removed: 1 },
      ],
      recordingTheme,
      60,
      false,
    );

    expect(colors).toContainEqual(["success", "??"]);
    expect(colors).toContainEqual(["success", "+2"]);
    expect(colors).toContainEqual(["warning", " M"]);
    expect(colors).toContainEqual(["error", "-1"]);
  });

  test("escapes terminal controls and line breaks in display paths", () => {
    const rows = renderChangeRows(
      [{ path: "src/line\n\u001b[31m.ts", kind: "added", added: 1, removed: 0 }],
      theme,
      50,
      false,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("src/line\\n\\x1b[31m.ts");
    expect(rows[0]).not.toContain("\n");
    expect(rows[0]).not.toContain("\u001b");
  });

  test("renders the local dock treatment within the available width", () => {
    const changes = Array.from(
      { length: 7 },
      (_, index): TrackedFile => ({
        path: `src/file-${index}.ts`,
        kind: "modified",
        added: index + 1,
        removed: 0,
      }),
    );
    const widget = new FileChangesWidget(changes, theme, () => false);
    const lines = widget.render(36);
    const plain = lines.map(stripTerminalSequences);

    expect(plain.some((line) => line.includes("Changes"))).toBe(false);
    expect(plain[0]).toBe(" ".repeat(36));
    expect(plain[1]).toContain(" M src/file-0.ts");
    expect(plain.at(-2)).toContain("… 1 more");
    expect(plain.at(-1)).toBe("▀".repeat(36));
    expect(lines.every((line) => visibleWidth(line) === 36)).toBe(true);
  });
});
