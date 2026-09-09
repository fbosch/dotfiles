import { describe, expect, test } from "bun:test";
import { analyzeDangerousCommand, dangerousCommandMatch } from "../dangerous-command";

describe("dangerousCommandMatch", () => {
  test("matches upstream forced-rm variants", async () => {
    for (const command of [
      ["rm", "-rf", "/tmp/example"],
      ["/bin/rm", "-fr", "/tmp/example"],
      ["rm", "-r", "-f", "/tmp/example"],
      ["rm", "-r-f", "/tmp/example"],
      ["rm", "--force", "/tmp/example"],
      ["rm", "/tmp/example", "-f"],
      ["sudo", "rm", "-rf", "/tmp/example"],
      ["env", "TARGET=/tmp/example", "rm", "-rf", "/tmp/example"],
      ["env", "-i", "--", "rm", "-f", "/tmp/example"],
    ]) {
      expect(await dangerousCommandMatch(command), command.join(" ")).toBe("forced-rm");
    }
  });

  test("detects forced rm inside upstream shell-source cases", async () => {
    for (const script of [
      "printf x | rm -rf /tmp/example",
      "if test -d /tmp/example; then rm --force /tmp/example; fi",
      'rm -rf "$TARGET" >/dev/null',
      'for target in /tmp/a /tmp/b; do rm -r -f "$target"; done',
      'echo "$(rm -rf /tmp/example)"',
      "bash -c 'rm -rf /tmp/example'",
      "trap 'rm -rf /tmp/example' EXIT",
      "for a in '-C5a25KeRr' '--' '--json' '--bogus'; do HOME=$(mktemp -d) MDE_URL=http://127.0.0.1:1 MDE_TOKEN=x node cli/mde.cjs ls \"$a\" >/tmp/mde-review-out 2>/tmp/mde-review-err; code=$?; printf '%s\\t%s\\t%s\\n' \"$a\" \"$code\" \"$(tr '\\n' ' ' </tmp/mde-review-err)\"; rm -rf \"$HOME\"; done",
    ]) {
      expect(await dangerousCommandMatch(["bash", "-lc", script]), script).toBe("forced-rm");
    }
  });

  test("detects forced rm in a direct trap action", async () => {
    expect(await dangerousCommandMatch(["trap", "rm -rf /tmp/example", "EXIT"])).toBe("forced-rm");
    expect(await dangerousCommandMatch(["trap", "--", "rm -rf /tmp/example", "EXIT"])).toBe(
      "forced-rm",
    );
  });

  test("does not match upstream non-forced or non-literal forms", async () => {
    for (const command of [
      ["rm", "-r", "/tmp/example"],
      ["rm", "--", "-f"],
      ["bash", "-lc", "echo 'rm -rf /tmp/example'"],
      ["bash", "-lc", "cmd=rm; $cmd -rf /tmp/example"],
      ["bash", "-lc", "if then rm -rf /tmp/example"],
      ["env", "TARGET=/tmp/example", "rm", "-r", "/tmp/example"],
      ["env", "==x", "rm", "-f", "/tmp/example"],
      ["bash", "-lc", "trap 'echo rm -rf /tmp/example' EXIT"],
    ]) {
      expect(await dangerousCommandMatch(command), command.join(" ")).toBeUndefined();
    }
  });

  test("fails closed after the upstream wrapper-depth limit", async () => {
    const withinLimit = [...Array.from({ length: 8 }, () => "env"), "rm", "-rf", "/tmp/example"];
    const beyondLimit = [...Array.from({ length: 9 }, () => "env"), "rm", "-rf", "/tmp/example"];

    expect(await dangerousCommandMatch(withinLimit)).toBe("forced-rm");
    expect(await dangerousCommandMatch(beyondLimit)).toBe("other");
  });

  test("distinguishes unmatched commands from invalid nested shell source", async () => {
    expect(await analyzeDangerousCommand(["git", "status"])).toEqual({ kind: "no_match" });
    expect(await analyzeDangerousCommand(["bash", "-lc", "if then rm -rf /tmp/example"])).toEqual({
      kind: "unknown",
    });
    expect(
      await dangerousCommandMatch(["bash", "-lc", "if then rm -rf /tmp/example"]),
    ).toBeUndefined();
  });
});
