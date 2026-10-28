import { describe, expect, test } from "bun:test";
import { inspectCommand } from "../inspection";
import { parseShell } from "../shell";

describe("literal shell inspection", () => {
  test.each([
    [
      "rm 'a b'; /bin/rm -f c",
      [
        ["rm", "a b"],
        ["/bin/rm", "-f", "c"],
      ],
    ],
    [
      "printf 'æøå' | tee file",
      [
        ["printf", "æøå"],
        ["tee", "file"],
      ],
    ],
    [
      "echo one # ignored rm\nrm two",
      [
        ["echo", "one"],
        ["rm", "two"],
      ],
    ],
    ["r\\m -f file", [["rm", "-f", "file"]]],
    ["echo a\\\nb", [["echo", "ab"]]],
    ["echo '' \"\"", [["echo", "", ""]]],
  ])("keeps command words separate from data: %s", (command, expected) => {
    if (typeof command !== "string") throw new Error("Invalid fixture");
    const parsed = parseShell(command);
    expect(parsed.kind).toBe("parsed");
    if (parsed.kind !== "parsed") return;
    expect(parsed.commands.map((part) => part.words.map((word) => word.value))).toEqual(expected);
    for (const part of parsed.commands) {
      for (const word of part.words)
        expect(command.slice(word.start, word.end).length).toBeGreaterThan(0);
    }
  });

  test.each([
    "echo $(rm file)",
    "echo `rm file`",
    "rm $TARGET",
    "rm *.txt",
    "(rm file)",
    "if true; then rm file; fi",
    "bash -c 'rm file'",
    "sudo rm file",
    "env rm file",
    "find src -exec rm '{}' ';'",
    "git -c alias.x=x push --force",
  ])("asks the classifier about opaque commands naming destructive operations: %s", (command) => {
    const inspection = inspectCommand(command);
    expect(inspection.kind).toBe("review");
    if (inspection.kind === "review")
      expect(inspection.input.state).toMatchObject({ lexicalOnly: true });
  });

  // Nono grants decide what opaque code may touch; the guard does not interrupt it.
  test.each([
    "cat <<EOF\ntext\nEOF",
    'echo "unterminated',
    "echo text >&2",
    "echo text 2>file",
    "python tools/deploy.py",
    "python -c 'print(1)'",
    "python -c 'import os; os.remove(\"x\")'",
    "node script.js",
    "./ls",
    "PATH=/tmp ls",
    "git -c alias.x=x status",
    "rg --pre=script pattern",
    "printf -v 'a[0]' text",
  ])("runs opaque commands without destructive operation names: %s", (command) => {
    expect(inspectCommand(command).kind).toBe("skip");
  });

  test.each([
    "sed -n 1,40p file.ts",
    "bun test extensions 2>&1 | tail -4",
    "git -C ~/dotfiles status --short",
    "git checkout main",
    'git commit -m "rm x"',
    "cd ~/dotfiles && grep -n x file.ts | head; wc -l file.ts",
  ])("ordinary parsed commands skip review: %s", (command) => {
    expect(inspectCommand(command).kind).toBe("skip");
  });

  test.each([
    ["find ./src -delete", { operations: ["find"], findDelete: true }],
    ["tee existing.txt", { operations: ["tee"], teeOverwrite: true }],
    ["printf '%s' 'rm -rf src' > file", { operations: [], shellOverwrite: true }],
    ["/bin/rm -rf src", { operations: ["rm"], recursive: true }],
    ["command rm -f src", { operations: ["rm"], force: true }],
    ["git branch -D topic", { branchDelete: true }],
  ])("provides fixed labels for supported effects: %s", (command, state) => {
    if (typeof command !== "string") throw new Error("Invalid fixture");
    const inspection = inspectCommand(command);
    expect(inspection.kind).toBe("review");
    if (inspection.kind === "review") expect(inspection.input.state).toMatchObject(state);
  });

  test("quoted data does not become an operation", () => {
    expect(inspectCommand("printf '%s' 'rm -rf src'").kind).toBe("skip");
    expect(inspectCommand("rg 'rm -rf' src").kind).toBe("skip");
  });
});
