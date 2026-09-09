import { describe, expect, test } from "bun:test";
import {
  analyzeDangerousCommand,
  dangerousCommandMatch,
  isDangerousCommandSafeInLocations,
} from "../dangerous-command";

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

  test("applies configured safe locations to location-scoped dangerous commands", async () => {
    const safeLocations = ["/tmp", "/var/tmp"];
    const isSafe = async (command: string) =>
      isDangerousCommandSafeInLocations(
        command,
        await analyzeDangerousCommand(["bash", "-lc", command]),
        safeLocations,
      );

    for (const command of [
      "rm /tmp/example",
      "rm -rf /tmp/example",
      "/bin/rm -r -f -- /tmp/example",
      "rm --recursive --force /tmp/example /tmp/other",
      "rm /var/tmp/example",
    ]) {
      expect(await isSafe(command), command).toBe(true);
    }

    for (const command of [
      "rm -rf /tmp",
      "rm -rf /tmp/",
      "rm -rf /tmp/example/../../outside",
      "rm -rf /home/example",
      'rm -rf "$TARGET"',
      "rm -rf /tmp/example && echo done",
    ]) {
      expect(await isSafe(command), command).toBe(false);
    }
  });

  test("uses supplied path evidence instead of an executable-specific rule", async () => {
    expect(
      await isDangerousCommandSafeInLocations(
        "printf /tmp/example",
        { kind: "dangerous", match: "other", pathValues: ["/tmp/example"] },
        ["/tmp"],
      ),
    ).toBe(true);
  });

  test("matches regular rm and ignores non-literal forms", async () => {
    for (const command of [
      ["rm", "-r", "/tmp/example"],
      ["rm", "--", "-f"],
      ["env", "TARGET=/tmp/example", "rm", "-r", "/tmp/example"],
    ]) {
      expect(await dangerousCommandMatch(command), command.join(" ")).toBe("rm");
    }

    for (const command of [
      ["bash", "-lc", "echo 'rm -rf /tmp/example'"],
      ["bash", "-lc", "cmd=rm; $cmd -rf /tmp/example"],
      ["bash", "-lc", "if then rm -rf /tmp/example"],
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
