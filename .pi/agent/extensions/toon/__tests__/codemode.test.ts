import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { decode } from "@toon-format/toon";
import toonExtension, { createToonTransformer } from "../index";

const HEADER = "Script completed\nWall time 0.2 seconds\nOutput:\n";
const VALUE = {
  path: "example.ts",
  lines: Array.from({ length: 30 }, (_, index) => ({
    anchor: `Ab${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`,
    text: index % 2 === 0 ? '  const value = "æøå\\n";\t' : "",
  })),
  truncated: false,
  nextOffset: null,
};
const JSON_RECORD = JSON.stringify(VALUE);

function event(
  content: ToolResultEvent["content"],
  overrides: Partial<ToolResultEvent> = {},
): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId: "codemode-call",
    toolName: "codemode",
    input: { code: "text(result)" },
    content,
    details: undefined,
    isError: false,
    ...overrides,
  } as ToolResultEvent;
}

function compact(text: string): string {
  const result = createToonTransformer().transformResult(event([{ type: "text", text }]));
  if (result?.[0]?.type !== "text") throw new Error("Expected compacted codemode output");
  return result[0].text;
}

describe("codemode TOON output", () => {
  test("compacts a combined envelope without changing anchors or exact source text", () => {
    const input = `${HEADER}\n${JSON_RECORD}\n`;
    const output = compact(input);
    expect(output.startsWith(`${HEADER}\n`)).toBe(true);
    expect(output.endsWith("\n")).toBe(true);
    expect(output.length).toBeLessThan(input.length);
    expect(decode(output.slice(HEADER.length))).toEqual(VALUE);
  });

  test("compacts separate native output blocks while preserving images and diagnostics", () => {
    const header = { type: "text", text: HEADER } as const;
    const image = { type: "image", data: "AA==", mimeType: "image/png" } as const;
    const diagnostics = { type: "text", text: "Warning: original output was truncated\n" } as const;
    const result = createToonTransformer().transformResult(
      event([header, { type: "text", text: JSON_RECORD }, image, diagnostics]),
    );
    expect(result?.[0]).toBe(header);
    expect(result?.[2]).toBe(image);
    expect(result?.[3]).toBe(diagnostics);
    if (result?.[1]?.type !== "text") throw new Error("Expected compacted record");
    expect(decode(result[1].text)).toEqual(VALUE);
  });

  test("compacts multiple complete records but preserves prose and truncated fragments", () => {
    const other = { rows: Array.from({ length: 30 }, (_, id) => ({ id, name: `user-${id}` })) };
    const fragment = '{"lines":[{"anchor":"ABcd","text":"unfinished';
    const notice = "[Full output: /tmp/codemode.txt (read with offset/limit)]";
    const output = compact(
      `${HEADER}\n${JSON_RECORD}\nplain output\n${fragment}\n${JSON.stringify(other)}\n${notice}`,
    );
    const body = output.slice(HEADER.length).trimStart();
    const [first, remainder] = body.split("\nplain output\n");
    expect(decode(first ?? "")).toEqual(VALUE);
    expect(remainder?.startsWith(`${fragment}\n`)).toBe(true);
    const second = remainder?.slice(fragment.length + 1).split(`\n${notice}`)[0];
    expect(decode(second ?? "")).toEqual(other);
    expect(output.endsWith(notice)).toBe(true);
  });

  test("supports a standalone pretty-printed JSON value", () => {
    const output = compact(`${HEADER}\n${JSON.stringify(VALUE, null, 2)}`);
    expect(decode(output.slice(HEADER.length))).toEqual(VALUE);
  });

  test("does not interpret JSON-looking lines inside non-JSON fences", () => {
    const fenced = `\`\`\`text\n${JSON_RECORD}\n\`\`\``;
    const output = compact(`${HEADER}\n${fenced}\n${JSON_RECORD}`);
    expect(output.startsWith(`${HEADER}\n${fenced}\n`)).toBe(true);
  });

  test("leaves errors, non-codemode envelopes, invalid records and lossy numbers unchanged", () => {
    const transformer = createToonTransformer();
    for (const input of [
      event([{ type: "text", text: `${HEADER}\n${JSON_RECORD}` }], { isError: true }),
      event([{ type: "text", text: `${HEADER}\n${JSON_RECORD}` }], { toolName: "bash" }),
      event([
        { type: "text", text: `Script failed\nWall time 0.2 seconds\nOutput:\n${JSON_RECORD}` },
      ]),
      event([{ type: "text", text: `${HEADER}\n{invalid JSON}` }]),
      event([
        {
          type: "text",
          text: `${HEADER}\n${JSON_RECORD.replace('"nextOffset":null', '"nextOffset":9007199254740993')}`,
        },
      ]),
    ])
      expect(transformer.transformResult(input)).toBeUndefined();
    expect(
      createToonTransformer("bash").transformResult(
        event([{ type: "text", text: `${HEADER}\n${JSON_RECORD}` }]),
      ),
    ).toBeUndefined();
  });

  test("preserves structuredContent identity in the extension hook", () => {
    type Handler = (event: never, context: ExtensionContext) => unknown;
    const handlers = new Map<string, Handler>();
    toonExtension({
      on: (name: string, handler: Handler) => {
        handlers.set(name, handler);
      },
    } as unknown as ExtensionAPI);
    const structuredContent = VALUE;
    const input = Object.assign(event([{ type: "text", text: `${HEADER}\n${JSON_RECORD}` }]), {
      structuredContent,
    });
    const result = handlers.get("tool_result")?.(input as never, {} as ExtensionContext) as
      | { content: ToolResultEvent["content"]; structuredContent?: unknown }
      | undefined;
    expect(result?.structuredContent).toBe(structuredContent);
    expect(input.content[0]).toEqual({ type: "text", text: `${HEADER}\n${JSON_RECORD}` });
    if (result?.content[0]?.type !== "text") throw new Error("Expected transformed hook output");
    expect(decode(result.content[0].text.slice(HEADER.length))).toEqual(VALUE);
  });
});
