import { describe, expect, test } from "bun:test";
import { resolveFormatterSettings } from "../settings";

const luaRule = {
  mode: "pipeline",
  files: { extensions: [".lua"] },
  commands: [{ command: "stylua", args: ["$FILE"] }],
};

describe("resolveFormatterSettings", () => {
  test("merges trusted project rules by ID and preserves rule order", () => {
    const settings = resolveFormatterSettings(
      {
        timeoutMs: 1_000,
        rules: {
          web: {
            mode: "first_available",
            files: { extensions: [".ts"] },
            commands: [{ command: "biome", args: ["format", "--write", "$FILE"] }],
          },
          lua: luaRule,
        },
      },
      {
        timeoutMs: 2_000,
        rules: {
          web: null,
          nix: {
            mode: "pipeline",
            files: { extensions: [".nix"] },
            commands: [{ command: "nixfmt", args: ["$FILE"] }],
          },
        },
      },
    );

    expect(settings.timeoutMs).toBe(2_000);
    expect(settings.rules.map(({ id }) => id)).toEqual(["lua", "nix"]);
    expect(settings.warnings).toEqual([]);
  });

  test("quarantines an invalid project replacement instead of using the global rule", () => {
    const settings = resolveFormatterSettings(
      { rules: { lua: luaRule } },
      {
        rules: {
          lua: {
            mode: "pipeline",
            files: { extensions: [".lua"] },
            commands: [{ command: "stylua", args: ["--check"] }],
          },
        },
      },
    );

    expect(settings.rules).toEqual([]);
    expect(settings.warnings).toEqual([
      "project formatter.rules.lua.commands[0].args: one argument must contain $FILE",
    ]);
  });

  test("rejects unknown fields so misspelled behavior cannot be ignored", () => {
    const settings = resolveFormatterSettings(
      {
        rules: {
          lua: {
            ...luaRule,
            stopAfterFirst: true,
          },
        },
      },
      {},
    );

    expect(settings.rules).toEqual([]);
    expect(settings.warnings).toEqual(["global formatter.rules.lua.stopAfterFirst: unknown field"]);
  });

  test("rejects timeout values beyond the runtime timer limit", () => {
    const settings = resolveFormatterSettings({ timeoutMs: 300_001, rules: { lua: luaRule } }, {});

    expect(settings.timeoutMs).toBe(30_000);
    expect(settings.warnings).toEqual([
      "global formatter.timeoutMs: expected an integer between 1 and 300000",
    ]);
  });
});
