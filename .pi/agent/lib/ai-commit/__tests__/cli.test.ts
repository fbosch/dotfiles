import { describe, expect, test } from "bun:test";
import { parseArgs } from "../cli";

describe("ai_commit arguments", () => {
  test("preserves the established dry-run, verbose, debug, and model flags", () => {
    expect(parseArgs(["-d", "-v", "-m", "openai-codex/gpt-5.6-luna-fast", "--debug"])).toEqual({
      dryRun: true,
      verbose: true,
      debug: true,
      restartServer: false,
      modelRef: "openai-codex/gpt-5.6-luna-fast",
    });
  });

  test("keeps the retired restart invocation as a harmless compatibility command", () => {
    expect(parseArgs(["restart-server"]).restartServer).toBeTrue();
  });

  test("preserves the previous handling of unrelated arguments", () => {
    expect(parseArgs(["--unknown"])).toEqual({
      dryRun: false,
      verbose: false,
      debug: false,
      restartServer: false,
      modelRef: undefined,
    });
  });
});
