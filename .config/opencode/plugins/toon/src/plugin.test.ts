import { describe, expect, test } from "bun:test";
import { ToonFormatPlugin, tryConvertJsonToToon } from "./plugin";

describe("toon plugin conversion", () => {
  test("converts large uniform JSON payloads", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      date: `2026-01-${String((i % 30) + 1).padStart(2, "0")}`,
      views: 1000 + i,
      clicks: 20 + (i % 5),
      conversions: 2 + (i % 3),
      revenue: 100.12 + i,
    }));
    const json = JSON.stringify(rows);

    const converted = tryConvertJsonToToon(json);

    expect(typeof converted).toBe("string");
    expect(converted?.length).toBeLessThan(json.length);
  });

  test("skips invalid JSON", () => {
    const converted = tryConvertJsonToToon("{not-json");

    expect(converted).toBeUndefined();
  });

  test("skips mixed output payloads", () => {
    const converted = tryConvertJsonToToon('stdout line\n{"ok":true,"items":[1,2,3]}');

    expect(converted).toBeUndefined();
  });

  test("skips small JSON payloads", () => {
    const converted = tryConvertJsonToToon('{"ok":true,"items":[1,2,3]}');

    expect(converted).toBeUndefined();
  });

  test("skips conversion when encoded payload is not shorter", () => {
    const json = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({
        key: i,
      })),
    );
    const converted = tryConvertJsonToToon(json, () => `${json}-longer`);

    expect(converted).toBeUndefined();
  });

  test("swallows encoder errors and leaves output unchanged", () => {
    const json = JSON.stringify(
      Array.from({ length: 50 }, (_, i) => ({
        key: i,
      })),
    );
    const converted = tryConvertJsonToToon(json, () => {
      throw new Error("encode failed");
    });

    expect(converted).toBeUndefined();
  });
});

describe("toon plugin hook", () => {
  test("mutates eligible tool output", async () => {
    const plugin = await ToonFormatPlugin({} as never);
    const hook = plugin["tool.execute.after"];

    expect(typeof hook).toBe("function");
    if (typeof hook !== "function") {
      return;
    }

    const original = JSON.stringify(
      Array.from({ length: 500 }, (_, i) => ({
        eventDate: `2026-01-${String((i % 30) + 1).padStart(2, "0")}`,
        campaignId: `campaign-${i % 20}`,
        sourceChannel: `channel-${i % 10}`,
        regionCode: `region-${i % 12}`,
        views: i,
        clicks: i % 11,
      })),
    );

    const output = {
      title: "bash output",
      output: original,
      metadata: {},
    };

    await hook(
      {
        tool: "bash",
        sessionID: "session",
        callID: "call",
        args: {},
      },
      output,
    );

    expect(output.output).not.toBe(original);
    expect(output.output.length).toBeLessThan(original.length);
  });
});
