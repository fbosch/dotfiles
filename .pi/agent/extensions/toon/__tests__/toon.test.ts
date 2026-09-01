import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import toonExtension, { createToonTransformer } from "../index";

const LONG_JSON = JSON.stringify({
  users: Array.from({ length: 30 }, (_, index) => ({
    active: index % 2 === 0,
    id: index + 1,
    name: `user-${index + 1}`,
  })),
});

function resultEvent(overrides: Partial<ToolResultEvent> = {}): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId: "call-1",
    toolName: "bash",
    input: { command: "example" },
    content: [{ type: "text", text: LONG_JSON }],
    details: undefined,
    isError: false,
    ...overrides,
  } as ToolResultEvent;
}

describe("TOON transformer", () => {
  test("compacts eligible JSON only when TOON is shorter", () => {
    const transformer = createToonTransformer("bash");
    const content = transformer.transformResult(resultEvent());

    expect(content).toBeDefined();
    expect(content?.[0]?.type).toBe("text");
    if (content?.[0]?.type !== "text") throw new Error("Expected compacted text content");
    expect(content[0].text.length).toBeLessThan(LONG_JSON.length);
    expect(content[0].text).not.toBe(LONG_JSON);
  });

  test("leaves ineligible, failed, short, invalid, and mixed results unchanged", () => {
    const transformer = createToonTransformer("bash");

    expect(transformer.transformResult(resultEvent({ toolName: "read" }))).toBeUndefined();
    expect(transformer.transformResult(resultEvent({ isError: true }))).toBeUndefined();
    expect(
      transformer.transformResult(resultEvent({ content: [{ type: "text", text: "{}" }] })),
    ).toBeUndefined();
    expect(
      transformer.transformResult(
        resultEvent({ content: [{ type: "text", text: `{${"x".repeat(300)}}` }] }),
      ),
    ).toBeUndefined();
    expect(
      transformer.transformResult(
        resultEvent({
          content: [
            { type: "text", text: LONG_JSON },
            { type: "text", text: "additional output" },
          ],
        }),
      ),
    ).toBeUndefined();
  });

  test("leaves lossy numbers and oversized output unchanged", () => {
    const transformer = createToonTransformer("bash");
    const unsafeIntegerJson = JSON.stringify({
      users: Array.from({ length: 30 }, () => ({ id: 1 })),
    }).replace('"id":1', '"id":9007199254740993');
    const oversizedJson = JSON.stringify({ value: "x".repeat(1_000_000) });
    const lossyDecimals = ["0.10000000000000001", "1e-324", "-0"];

    expect(
      transformer.transformResult(
        resultEvent({ content: [{ type: "text", text: unsafeIntegerJson }] }),
      ),
    ).toBeUndefined();
    for (const number of lossyDecimals) {
      const json = LONG_JSON.replace('"id":1', `"id":${number}`);
      expect(
        transformer.transformResult(resultEvent({ content: [{ type: "text", text: json }] })),
      ).toBeUndefined();
    }
    expect(
      transformer.transformResult(
        resultEvent({ content: [{ type: "text", text: oversizedJson }] }),
      ),
    ).toBeUndefined();
  });

  test("an explicit empty tool list disables compaction", () => {
    const transformer = createToonTransformer("");
    expect(transformer.transformResult(resultEvent())).toBeUndefined();
  });

  test("restores compacted output in a standalone single-quoted Bash argument", () => {
    const transformer = createToonTransformer("bash");
    const content = transformer.transformResult(resultEvent());
    if (content?.[0]?.type !== "text") throw new Error("Expected compacted text content");
    const toon = content[0].text;

    expect(transformer.restoreCommand(`printf '%s' '${toon}' | jq .`)).toBe(
      `printf '%s' '${LONG_JSON}' | jq .`,
    );
  });

  test("does not rewrite TOON embedded inside a larger shell word", () => {
    const transformer = createToonTransformer("bash");
    const hostileJson = JSON.stringify({
      rows: Array.from({ length: 30 }, () => ({ value: "$(printf PWNED)" })),
    });
    const content = transformer.transformResult(
      resultEvent({ content: [{ type: "text", text: hostileJson }] }),
    );
    if (content?.[0]?.type !== "text") throw new Error("Expected compacted text content");
    const command = `printf '%s' 'prefix${content[0].text}suffix'`;

    expect(transformer.restoreCommand(command)).toBe(command);
  });

  test("does not rewrite quote-like text inside a double-quoted shell word", () => {
    const transformer = createToonTransformer("bash");
    const hostileJson = JSON.stringify({
      rows: Array.from({ length: 30 }, () => ({ value: "; printf PWNED; #" })),
    });
    const content = transformer.transformResult(
      resultEvent({ content: [{ type: "text", text: hostileJson }] }),
    );
    if (content?.[0]?.type !== "text") throw new Error("Expected compacted text content");
    const command = `bash -c "printf '%s' '${content[0].text}'"`;

    expect(transformer.restoreCommand(command)).toBe(command);
  });

  test("does not rewrite quote-like text inside a shell comment", () => {
    const transformer = createToonTransformer("bash");
    const prettyJson = JSON.stringify(
      { values: Array.from({ length: 40 }, () => "$(printf COMMENT_PWNED)") },
      undefined,
      2,
    );
    const content = transformer.transformResult(
      resultEvent({ content: [{ type: "text", text: prettyJson }] }),
    );
    if (content?.[0]?.type !== "text") throw new Error("Expected compacted text content");
    const command = `# '${content[0].text}'\nprintf 'SAFE\\n'`;

    expect(transformer.restoreCommand(command)).toBe(command);
  });

  test("stops restoring output after the exact-output cache is cleared", () => {
    const transformer = createToonTransformer("bash");
    const prettyJson = JSON.stringify(JSON.parse(LONG_JSON), undefined, 2);
    const content = transformer.transformResult(
      resultEvent({ content: [{ type: "text", text: prettyJson }] }),
    );
    if (content?.[0]?.type !== "text") throw new Error("Expected compacted text content");
    const command = `printf '%s' '${content[0].text}'`;

    expect(transformer.restoreCommand(command)).toBe(`printf '%s' '${prettyJson}'`);

    transformer.clear();

    expect(transformer.restoreCommand(command)).toBe(command);
  });

  test("does not overwrite an exact-output mapping with different JSON formatting", () => {
    const transformer = createToonTransformer("bash");
    const prettyJson = JSON.stringify(JSON.parse(LONG_JSON), undefined, 2);

    expect(
      transformer.transformResult(resultEvent({ content: [{ type: "text", text: prettyJson }] })),
    ).toBeDefined();
    expect(transformer.transformResult(resultEvent())).toBeUndefined();
  });
});

test("wires result compaction and Bash restoration into Pi hooks", () => {
  type Handler = (event: never, context: ExtensionContext) => unknown;
  const handlers = new Map<string, Handler>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  toonExtension(pi);

  const resultHandler = handlers.get("tool_result");
  const callHandler = handlers.get("tool_call");
  if (resultHandler === undefined || callHandler === undefined) {
    throw new Error("TOON extension handlers were not registered");
  }

  const transformed = resultHandler(resultEvent() as never, {} as ExtensionContext) as
    | { content: ToolResultEvent["content"] }
    | undefined;
  if (transformed?.content[0]?.type !== "text") throw new Error("Expected compacted result");

  const call = {
    type: "tool_call",
    toolCallId: "call-2",
    toolName: "bash",
    input: { command: `printf '%s' '${transformed.content[0].text}' | jq .` },
  } as const;
  callHandler(call as never, {} as ExtensionContext);

  expect(call.input.command).toBe(`printf '%s' '${LONG_JSON}' | jq .`);
});
