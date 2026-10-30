import { describe, expect, test } from "bun:test";
import { CHUNK_CHARS, parseEntry, skipWithoutParsing, splitText } from "../parse";
import { assistant, compaction, header, title, toolResult, user } from "./fixtures";

describe("parseEntry", () => {
  test("indexes user text and records it as the first request", () => {
    const parsed = parseEntry(user("Fix the webhook retry", "m1"));
    expect(parsed).toMatchObject({
      kind: "chunks",
      firstUser: "Fix the webhook retry",
      chunks: [{ messageId: "m1", role: "user", text: "Fix the webhook retry" }],
    });
  });

  test("indexes assistant text and tool calls but not thinking", () => {
    const parsed = parseEntry(
      assistant(
        [
          { type: "thinking", thinking: "secret reasoning" },
          { type: "text", text: "Reading the config." },
          { type: "toolCall", id: "c1", name: "read", arguments: { path: "src/webhook.ts" } },
        ],
        "m2",
      ),
    );
    if (parsed.kind !== "chunks") throw new Error("expected chunks");
    expect(parsed.chunks.map((chunk) => [chunk.role, chunk.text])).toEqual([
      ["assistant", "Reading the config."],
      ["tool", 'read {"path":"src/webhook.ts"}'],
    ]);
    expect(JSON.stringify(parsed)).not.toContain("secret reasoning");
  });

  test("indexes compaction summaries", () => {
    expect(parseEntry(compaction("## Goal\nShip it", "m3"))).toMatchObject({
      kind: "chunks",
      chunks: [{ messageId: "m3", role: "summary" }],
    });
  });

  test("reads the header and session title", () => {
    expect(parseEntry(header("s1", "/work"))).toMatchObject({
      kind: "header",
      id: "s1",
      cwd: "/work",
    });
    expect(parseEntry(title("Webhook retries"))).toMatchObject({
      kind: "title",
      title: "Webhook retries",
    });
  });

  test("skips tool results", () => {
    expect(parseEntry(toolResult("TOKEN=abc"))).toMatchObject({ kind: "skip" });
  });
});

describe("skipWithoutParsing", () => {
  test("skips tool results and custom entries from their prefix", () => {
    expect(skipWithoutParsing(JSON.stringify(toolResult("x")))).toBe(true);
    expect(skipWithoutParsing('{"type":"custom","customType":"x"}')).toBe(true);
    expect(skipWithoutParsing(JSON.stringify(user("x")))).toBe(false);
    expect(skipWithoutParsing(JSON.stringify(compaction("x")))).toBe(false);
  });
});

describe("splitText", () => {
  test("splits long messages into overlapping chunks", () => {
    const parts = splitText("a".repeat(CHUNK_CHARS * 2 + 10));
    expect(parts.length).toBe(3);
    expect(parts.every((part) => part.length <= CHUNK_CHARS)).toBe(true);
  });
});
