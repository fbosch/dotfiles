import { describe, expect, test } from "bun:test";
import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import subagentSteeringNotice from "../subagent-steering-notice";

type Resolver = Parameters<Parameters<typeof subagentSteeringNotice>[0]["registerToolRenderer"]>[0];
type Renderers = NonNullable<ReturnType<Resolver>>;
type RenderContext = Parameters<NonNullable<Renderers["renderResult"]>>[3];

function resolver(): Resolver {
  let registered: Resolver | undefined;
  subagentSteeringNotice({
    registerToolRenderer: (callback) => {
      registered = callback;
    },
  });
  if (!registered) throw new Error("Missing steering renderer");
  return registered;
}

const theme = { fg: (_color: string, text: string) => text } as unknown as Theme;
const context: RenderContext = {
  args: { agent_id: "agent-æøå", message: "Review the error path" },
  toolCallId: "steer-1",
  invalidate() {},
  lastComponent: undefined,
  state: {},
  cwd: "/tmp",
  executionStarted: true,
  argsComplete: true,
  isPartial: false,
  expanded: false,
  showImages: false,
  isError: false,
};
const sent =
  "Steering message sent to agent agent-æøå. The agent will process it after its current tool execution.\nCurrent state: 12k tokens · 3 tool uses · context 20% full";
const queued =
  "Steering message queued for agent agent-æøå. It will be delivered once the session initializes.";
const result = (text: string): AgentToolResult<unknown> => ({
  content: [{ type: "text", text }],
  details: undefined,
});

function render(
  output: AgentToolResult<unknown>,
  overrides: Partial<RenderContext> = {},
  original?: Renderers,
) {
  const renderer = resolver()("steer_subagent", () => original)?.renderResult;
  if (!renderer) throw new Error("Missing result renderer");
  const ctx = { ...context, ...overrides };
  return renderer(output, { expanded: ctx.expanded, isPartial: ctx.isPartial }, theme, ctx);
}

const textOf = (component: ReturnType<typeof render>) =>
  component
    .render(240)
    .map((line) => line.trimEnd())
    .join("\n");

describe("subagent steering notices", () => {
  test.each([
    { text: sent, status: "sent" },
    { text: queued, status: "queued" },
  ])("compacts $status steering confirmations", ({ text, status }) => {
    const output = result(text);
    const before = structuredClone(output);
    const component = render(output);
    expect(textOf(component)).toBe(`Subagent steering ${status} · agent-æøå`);
    expect(component.render(120)).toHaveLength(1);
    for (const width of [1, 24, 80]) {
      expect(component.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
    }
    expect(output).toEqual(before);
  });

  test("uses the same dim, unpadded presentation as task and skill notices", () => {
    const renderer = resolver()("steer_subagent", () => undefined)?.renderResult;
    if (!renderer) throw new Error("Missing result renderer");
    const dimTheme = {
      fg: (color: string, text: string) => {
        expect(color).toBe("dim");
        return text;
      },
    } as unknown as Theme;
    const component = renderer(
      result(sent),
      { expanded: false, isPartial: false },
      dimTheme,
      context,
    );
    expect(component.render(120).map((line) => line.trimEnd())).toEqual([
      "Subagent steering sent · agent-æøå",
    ]);
  });

  test.each([sent, queued])("retains full details on expansion: %s", (text) => {
    expect(textOf(render(result(text), { expanded: true }))).toBe(text);
  });

  test.each([
    'Agent not found: "missing". Records are cleared at session start/switch, so it may be from a previous session.',
    'Agent "agent-æøå" is not running (status: completed). Cannot steer a non-running agent.',
    "Failed to steer agent: session closed",
    `${sent}\nWarning: additional information`,
    "Steering message sent to agent agent-æøå. Changed upstream response.",
  ])("does not hide errors or unrecognized output: %s", (text) => {
    expect(textOf(render(result(text)))).toBe(text);
  });

  test.each([{ isError: true }, { isPartial: true }])(
    "does not compact flagged output: %j",
    (flags) => {
      expect(textOf(render(result(sent), flags))).toBe(sent);
    },
  );

  test("does not discard additional content blocks", () => {
    const output = result(sent);
    output.content.push({ type: "text", text: "Extra diagnostic" });
    expect(textOf(render(output))).toBe(`${sent}\nExtra diagnostic`);
  });

  test("preserves other tools, the call renderer, and the shell", () => {
    const original = {
      renderShell: "self" as const,
      renderCall: () => new Text("Original call", 0, 0),
      renderResult: () => new Text("Original result", 0, 0),
    };
    const resolve = resolver();
    expect(resolve("subagent", () => original)).toBe(original);
    expect(resolve("unknown", () => undefined)).toBeUndefined();
    const steering = resolve("steer_subagent", () => original);
    expect(steering?.renderShell).toBe(original.renderShell);
    expect(steering?.renderCall).toBe(original.renderCall);
    expect(textOf(render(result(sent), { expanded: true }, original))).toBe("Original result");
    expect(textOf(render(result("Failed to steer agent"), {}, original))).toBe("Original result");
  });
});
