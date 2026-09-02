import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatAnsiReferenceMentions, formatReferenceMentions } from "../project-references";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-reference-mentions-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("reference mentions", () => {
  test("formats configured references and existing file paths only", () => {
    const cwd = temporaryDirectory();
    writeFileSync(join(cwd, "opencode.json"), "{}\n");
    const references = [
      { name: "nixos", path: "/home/fbb/nixos", description: "Personal configuration" },
    ];

    expect(
      formatReferenceMentions(
        "Read @opencode.json and @nixos but leave @explore unchanged",
        references,
        cwd,
        (text) => `<orange>${text}</orange>`,
      ),
    ).toBe(
      "Read <orange>@opencode.json</orange> and <orange>@nixos</orange> but leave @explore unchanged",
    );
  });

  test("supports quoted file paths", () => {
    const cwd = temporaryDirectory();
    writeFileSync(join(cwd, "file with spaces.md"), "text\n");

    expect(
      formatReferenceMentions('Read @"file with spaces.md"', [], cwd, (text) => `[${text}]`),
    ).toBe('Read [@"file with spaces.md"]');
  });

  test("restores orange after foreground resets inside editor tokens", () => {
    const cwd = temporaryDirectory();
    writeFileSync(join(cwd, "opencode.json"), "{}\n");
    const orange = "\u001b[38;2;183;126;100m";
    const reset = "\u001b[39m";
    const input = `Read @open${reset}code.json`;

    expect(formatAnsiReferenceMentions(input, [], cwd, orange)).toBe(
      `Read ${orange}@open${reset}${orange}code.json${reset}`,
    );
  });
});
