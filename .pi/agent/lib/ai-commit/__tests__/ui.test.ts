import { describe, expect, test } from "bun:test";
import { formatCommitCommand, shellQuote } from "../ui";

describe("commit command rendering", () => {
  test("quotes apostrophes for a POSIX shell", () => {
    expect(shellQuote("don't truncate")).toBe("'don'\"'\"'t truncate'");
  });

  test("keeps command substitutions inside one quoted argument", () => {
    expect(formatCommitCommand("fix(cli): keep $(touch /tmp/marker) literal")).toBe(
      "git commit -m 'fix(cli): keep $(touch /tmp/marker) literal'",
    );
  });
});
