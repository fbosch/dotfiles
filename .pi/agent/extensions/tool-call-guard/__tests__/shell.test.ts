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
    "cat <<EOF\ntext\nEOF",
    "rm $TARGET",
    "rm *.txt",
    "(rm file)",
    "if true; then rm file; fi",
    'echo "unterminated',
    "echo text >",
    "echo text >&2",
    "echo text 2>file",
    "echo text &",
    "echo text\r\n",
    "rm file\\",
  ])("does not establish safety for unsupported input: %s", (command) => {
    expect(inspectCommand(command).kind).toBe("unknown");
  });

  test.each([
    "python tools/deploy.py",
    "python -c 'print(1)'",
    "python -c 'import os; os.remove(\"x\")'",
    "node script.js",
    "bash -c 'rm file'",
    "sudo rm file",
    "env rm file",
    "./ls",
    "/tmp/ls",
    "PATH=/tmp ls",
    "find src -exec rm '{}' ';'",
    "curl --config settings",
    "git -c alias.x=x status",
    "git checkout main",
    "rg --pre=script pattern",
    "printf -v 'a[0]' text",
  ])("routes opaque execution to local approval: %s", (command) => {
    const inspection = inspectCommand(command);
    expect(inspection.kind).toBe("unknown");
    expect(inspection).not.toHaveProperty("input");
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
