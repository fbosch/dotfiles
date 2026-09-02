import { describe, expect, test } from "bun:test";
import { parseArgs } from "../cli";

describe("ai_commit arguments", () => {
  test("preserves established short flags and accepts headless confirmation", () => {
    expect(parseArgs(["-d", "-v", "-m", "openai-codex/gpt-5.6-luna-fast", "--yes"])).toEqual({
      dryRun: true,
      verbose: true,
      debug: false,
      accept: true,
      help: false,
      legacyRestart: false,
      modelRef: "openai-codex/gpt-5.6-luna-fast",
    });
  });

  test("recognizes the retired server command without starting a commit", () => {
    expect(parseArgs(["restart-server"]).legacyRestart).toBeTrue();
  });

  test("rejects unknown arguments", () => {
    expect(() => parseArgs(["--unknown"])).toThrow("Unknown argument: --unknown");
  });
});
