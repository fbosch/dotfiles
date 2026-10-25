import { expect, test } from "bun:test";
import {
  initTheme,
  type ToolDefinition,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { theme } from "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { stripTerminalSequences, type Terminal, Text, TuiAltScreen } from "@earendil-works/pi-tui";

const { regRead } = (await import(
  new URL("../../../npm/node_modules/pi-hashline-edit-pro/src/read.ts", import.meta.url).href
)) as {
  regRead(pi: { registerTool(tool: ToolDefinition): void }): void;
};

import { registerHashlineReadRendering as extension } from "../read-rendering";

initTheme("dark", false);
type Resolver = Parameters<Parameters<typeof extension>[0]["registerToolRenderer"]>[0];
function setup() {
  let read: ToolDefinition | undefined;
  regRead({
    registerTool(tool) {
      read = tool;
    },
  });
  if (!read) throw new Error("Installed hashline read was not registered");
  let resolver: Resolver | undefined;
  extension({
    registerToolRenderer(value) {
      resolver = value;
    },
  });
  if (!resolver) throw new Error("Read renderer was not registered");
  return { original: read, renderer: resolver("read", () => read)!, resolver };
}
const context = {
  args: { path: "fixture.ts", offset: "abcde" },
  argsComplete: true,
  cwd: "/tmp",
  executionStarted: true,
  expanded: true,
  invalidate() {},
  isError: false,
  isPartial: false,
  durationMs: undefined,
  outputPad: 1,
  lastComponent: undefined,
  showImages: false,
  state: {},
  toolCallId: "read",
};
const result = {
  content: [
    {
      type: "text" as const,
      text: 'abcde│const name = "æøå";\nfghij│\nklmno│return name;\n\n[Showing lines 7–9 of 12. Use offset=klmno to continue.]',
    },
  ],
  details: { offset: 7 },
};
test("installed hashline read gets highlighted source with numbered gutters and preserved metadata", () => {
  const { original, renderer } = setup();
  const before = JSON.stringify(result);
  const component = renderer.renderResult!(
    result,
    { expanded: true, isPartial: false },
    theme,
    context,
  );
  const output = component.render(160).join("\n");
  const plain = stripTerminalSequences(output);
  expect(plain).toContain('7 │ const name = "æøå";');
  expect(plain).toContain("8 │");
  expect(plain).toContain("9 │ return name;");
  expect(plain).toContain("[Showing lines 7–9 of 12. Use offset=klmno to continue.]");
  expect(output).toContain(theme.getFgAnsi("syntaxKeyword"));
  expect(JSON.stringify(result)).toBe(before);
  expect(renderer.renderCall).toBe(original.renderCall);
});
test("errors, partial results, images and non-hashline output keep the original renderer", () => {
  const { original, renderer, resolver } = setup();
  const cases = [
    { value: result, options: { expanded: true, isPartial: true }, ctx: context },
    {
      value: result,
      options: { expanded: true, isPartial: false },
      ctx: { ...context, isError: true },
    },
    {
      value: {
        content: [{ type: "text" as const, text: "File could not be read" }],
        details: undefined,
      },
      options: { expanded: true, isPartial: false },
      ctx: context,
    },
    {
      value: {
        content: [{ type: "image" as const, data: "", mimeType: "image/png" }],
        details: undefined,
      },
      options: { expanded: true, isPartial: false },
      ctx: context,
    },
  ];
  for (const { value, options, ctx } of cases) {
    expect(renderer.renderResult!(value, options, theme, ctx).render(100)).toEqual(
      original.renderResult!(value, options, theme, ctx).render(100),
    );
  }
  const other = { renderResult: () => new Text("other") };
  expect(resolver("bash", () => other)).toBe(other);
  expect(resolver("read", () => undefined)).toBeUndefined();
});
test("the same resolved renderer works in native main-window and saved subagent tool components", async () => {
  const { renderer } = setup();
  const { workerTranscript } = await import("../../subagents/rendering");
  const terminal: Terminal = {
    columns: 120,
    rows: 30,
    kittyProtocolActive: false,
    start() {},
    stop() {},
    async drainInput() {},
    write() {},
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
    setProgramStatus() {},
  };
  const tui = new TuiAltScreen(terminal, false);
  const native = new ToolExecutionComponent(
    "read",
    "call",
    context.args,
    {},
    renderer,
    tui,
    "/tmp",
  );
  native.setExpanded(true);
  native.updateResult({ ...result, isError: false });
  const usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const saved = workerTranscript(
    {
      id: "worker",
      parentSessionId: "parent",
      specialist: "quick",
      status: "idle",
      liveSession: "available",
      currentAssignmentId: "assignment",
      createdAt: 0,
      config: {
        name: "quick",
        description: "",
        prompt: "",
        model: "fixture/model",
        maxTurns: 3,
        tools: [],
        excludeTools: [],
        extensions: [],
        skills: [],
      },
      assignments: [
        {
          id: "assignment",
          prompt: "read",
          outcome: "completed",
          maxTurns: 3,
          turnsUsed: 1,
          remainingTurns: 2,
          persistence: "saved",
          transcript: [
            {
              role: "assistant",
              timestamp: 1,
              text: JSON.stringify({
                role: "assistant",
                api: "openai-completions",
                provider: "fixture",
                model: "fixture",
                timestamp: 1,
                usage,
                stopReason: "toolUse",
                content: [{ type: "toolCall", id: "call", name: "read", arguments: context.args }],
              }),
            },
            {
              role: "tool",
              timestamp: 2,
              text: JSON.stringify({
                ...result,
                role: "toolResult",
                toolCallId: "call",
                toolName: "read",
                isError: false,
                timestamp: 2,
              }),
            },
          ],
        },
      ],
    },
    undefined,
    theme,
    { tui, cwd: "/tmp", getToolRenderers: () => renderer },
  );
  const mainLines = native.render(120);
  const savedLines = saved.render(120);
  const mainSource = mainLines.find((line) =>
    stripTerminalSequences(line).includes("7 │ const name"),
  );
  expect(mainSource).toBeDefined();
  expect(savedLines).toContain(mainSource!);
});

test.skipIf(!process.env.PI_SUBAGENT_TEST_SDK)(
  "installed Pi loads the shared renderer through its native extension loader",
  async () => {
    const sdkPath = process.env.PI_SUBAGENT_TEST_SDK!;
    const loader = (await import(
      new URL("./core/extensions/loader.js", "file://" + sdkPath).href
    )) as {
      loadExtensions(
        paths: string[],
        cwd: string,
      ): Promise<{ errors: unknown[]; extensions: object[] }>;
    };
    const loaded = await loader.loadExtensions(
      [new URL("../index.ts", import.meta.url).pathname],
      process.cwd(),
    );
    expect(loaded.errors).toEqual([]);
    expect(loaded.extensions).toHaveLength(1);
    const resolvers: unknown = Reflect.get(loaded.extensions[0]!, "toolRenderers");
    expect(Array.isArray(resolvers)).toBe(true);
    if (!Array.isArray(resolvers)) throw new Error("Native renderer registration missing");
    expect(resolvers).toHaveLength(2);
  },
);

test("source anchors are display-only and unknown extensions retain text and warning content", () => {
  const { renderer } = setup();
  const value = {
    content: [
      {
        type: "text" as const,
        text: "abcde│fghij│literal file content\nklmno│æøå\n\n[Warning: incomplete preview]",
      },
    ],
    details: { offset: 12 },
  };
  const output = renderer.renderResult!(value, { expanded: true, isPartial: false }, theme, {
    ...context,
    args: { path: "fixture.unknown", offset: "abcde" },
  })
    .render(120)
    .map(stripTerminalSequences)
    .join("\n");
  expect(output).toContain("12 │ fghij│literal file content");
  expect(output).toContain("13 │ æøå");
  expect(output).toContain("[Warning: incomplete preview]");
});
