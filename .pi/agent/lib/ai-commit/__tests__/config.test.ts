import { describe, expect, test } from "bun:test";
import { resolveCommitMessageModelConfig } from "../config";

describe("commit message model settings", () => {
  test("merges trusted project fields over the global setting", () => {
    expect(
      resolveCommitMessageModelConfig(
        {
          commitMessageModel: {
            model: "openai-codex/gpt-5.6-luna-fast",
            thinkingLevel: "off",
          },
        },
        { commitMessageModel: { thinkingLevel: "minimal" } },
      ),
    ).toEqual({
      model: "openai-codex/gpt-5.6-luna-fast",
      thinkingLevel: "minimal",
    });
  });

  test("supports disabling the dedicated model in project settings", () => {
    expect(
      resolveCommitMessageModelConfig(
        { commitMessageModel: { model: "openai-codex/gpt-5.6-luna-fast" } },
        { commitMessageModel: false },
      ),
    ).toBeNull();
  });

  test("rejects malformed model and thinking settings", () => {
    expect(() =>
      resolveCommitMessageModelConfig({ commitMessageModel: { model: "gpt-5.6-luna-fast" } }),
    ).toThrow("provider/model");
    expect(() =>
      resolveCommitMessageModelConfig({
        commitMessageModel: {
          model: "openai-codex/gpt-5.6-luna-fast",
          thinkingLevel: "none",
        },
      }),
    ).toThrow("commitMessageModel.thinkingLevel");
  });
});
