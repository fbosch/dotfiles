import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ClassifierContext, Usage } from "@earendil-works/pi-ai";
import {
  createBashTool,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolResultEvent,
  type ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import type { requestClassifier } from "../../../lib/classifier";
import { registerToolOutputPilot } from "../index";
import {
  eligibleOutput,
  hasSensitiveText,
  MAX_ATTEMPTS,
  pilotConfig,
  selectBlocks,
  selectionRequest,
  splitOutput,
} from "../policy";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const output = Array.from({ length: 600 }, (_, i) => `Progress ${i}: æ ø å 😀\r\n`).join("");
const approved = {
  classifier: {
    toolOutputPilot: {
      mode: "shadow",
      approvedCommands: [{ cwd: "/work", command: "run-fixture", goal: "Find the final result" }],
    },
  },
};
function result(text = output): ToolResultEvent {
  return {
    type: "tool_result",
    toolName: "bash",
    toolCallId: "call_1",
    input: { command: "run-fixture" },
    content: [{ type: "text", text }],
    details: undefined,
    structuredContent: { output: text, truncated: false, exit_code: 0, wall_time_seconds: 1 },
    isError: false,
  };
}
function scores(input: ClassifierContext, score = 0, confidence = 0.99) {
  return Object.fromEntries(
    Object.keys(input.questions).map((id) => [
      id,
      {
        type: "score" as const,
        score,
        confidence,
      },
    ]),
  );
}
const classify: typeof requestClassifier = async (_registry, input) => ({
  ok: true,
  value: { answers: scores(input) },
});
type Handler = (
  event: ToolResultEvent,
  ctx: ExtensionContext,
) => Promise<ToolResultEventResult | undefined>;
async function harness(request: typeof requestClassifier = classify) {
  const root = await mkdtemp(join(tmpdir(), "tool-output-pilot-test-"));
  roots.push(root);
  const records: Record<string, unknown>[] = [];
  const handlers = new Map<string, Handler>();
  const requests: ClassifierContext[] = [];
  let settings: { global: unknown; project: unknown } = { global: approved, project: undefined };
  const context = {
    cwd: "/work",
    isProjectTrusted: () => true,
    modelRegistry: {},
    signal: undefined,
  } as unknown as ExtensionContext;
  const api = {
    on: (name: string, handler: Handler) => {
      handlers.set(name, handler);
    },
    appendEntry: (_name: string, data: Record<string, unknown>) => {
      records.push(data);
    },
  } as unknown as Pick<ExtensionAPI, "on" | "appendEntry">;
  registerToolOutputPilot(api, {
    request: async (registry, input, options) => {
      requests.push(input);
      expect(options?.settingsContext).toBe(context);
      return request(registry, input, options);
    },
    settings: () => settings,
    artifactRoot: () => root,
  });
  return {
    root,
    context,
    records,
    requests,
    setSettings: (global: unknown, project: unknown = undefined) => {
      settings = { global, project };
    },
    run: (event = result()) => handlers.get("tool_result")?.(event, context),
    reset: () => handlers.get("session_start")?.(result(), context),
  };
}

test("pilot is off by default and rejects active mode or ambiguous approvals", () => {
  expect(pilotConfig({}).mode).toBe("off");
  expect(pilotConfig(approved).mode).toBe("shadow");
  for (const value of [
    null,
    { mode: "active", approvedCommands: [] },
    {
      mode: "shadow",
      approvedCommands: [{ cwd: "relative", command: "run", goal: "test" }],
    },
    { mode: "shadow", approvedCommands: [], typo: true },
  ]) {
    expect(() => pilotConfig({ classifier: { toolOutputPilot: value } })).toThrow();
  }
});

test("blocks preserve exact Unicode, CRLF, ordering, and final unterminated lines", () => {
  const text = `${output}final æøå`;
  const blocks = splitOutput(text);
  expect(blocks).toBeDefined();
  expect(blocks?.map((block) => block.text).join("")).toBe(text);
  for (const block of blocks ?? []) {
    expect(text.slice(block.start, block.end)).toBe(block.text);
  }
  expect(splitOutput("x".repeat(8_001))).toBeUndefined();
});

test("selection preserves diagnostics, boundaries, uncertain and relevant blocks", () => {
  const blocks = splitOutput(output);
  if (!blocks) throw new Error("Missing fixture blocks");
  const [first, second, third, fourth] = blocks;
  if (!first || !second || !third || !fourth) throw new Error("Missing fixture blocks");
  second.pinned = true;
  const input = selectionRequest("Find diagnostics", blocks);
  const answers = scores(input);
  answers[third.id] = { type: "score", score: 0, confidence: 0.5 };
  answers[fourth.id] = { type: "score", score: 2, confidence: 0.99 };
  const selection = selectBlocks(answers, input, blocks);
  expect(selection.filter((block) => block.selected).length).toBeGreaterThanOrEqual(4);
  expect(selection[0]?.selected).toBe(true);
  expect(selection[1]?.selected).toBe(true);
  expect(selection[2]?.selected).toBe(true);
  expect(selection[3]?.selected).toBe(true);
  expect(selection.at(-1)?.selected).toBe(true);
  expect(() => selectBlocks({}, input, blocks)).toThrow();
  expect(() => selectBlocks(scores(input, 9), input, blocks)).toThrow();
  const warning = splitOutput(`${output.slice(0, 5_000)}\nWARNING: incomplete check\n${output}`);
  expect(warning?.find((block) => block.text.includes("WARNING"))?.pinned).toBe(true);
});

test("shadow stores exact native Bash output privately without replacing any result field", async () => {
  const h = await harness();
  const tool = createBashTool("/work", {
    operations: {
      exec: async (_command, _cwd, { onData }) => {
        onData(Buffer.from(output));
        return { exitCode: 0 };
      },
    },
  });
  const native = await tool.execute("native-call", { command: "run-fixture" });
  const event: ToolResultEvent = { ...result(), ...native, isError: native.isError === true };
  const before = structuredClone(event);
  expect(await h.run(event)).toBeUndefined();
  expect(event).toEqual(before);
  expect(event.structuredContent).toBe(native.structuredContent);
  expect(h.requests).toHaveLength(1);
  expect(h.records[0]?.outcome).toBe("scored");
  expect(h.records[0]?.proposedOmittedBytes).toBeGreaterThan(0);
  const artifact = String(h.records[0]?.artifactPath);
  const reportPath = String(h.records[0]?.reportPath);
  expect(await readFile(artifact, "utf8")).toBe(output);
  expect((await stat(dirname(artifact))).mode & 0o777).toBe(0o700);
  expect((await stat(artifact)).mode & 0o777).toBe(0o600);
  expect((await stat(reportPath)).mode & 0o777).toBe(0o600);
  const report = await readFile(reportPath, "utf8");
  expect(report).not.toContain("Progress");
  expect(report).not.toContain("run-fixture");
  expect(report).not.toContain("Find the final result");
  expect(JSON.stringify(h.requests)).not.toContain("/work");
});

test("off, global disable, project disable, untrusted cwd, and exact-command mismatch do no work", async () => {
  const h = await harness();
  h.setSettings({});
  await h.run();
  h.setSettings({ classifier: { ...approved.classifier, enabled: false } });
  await h.run();
  h.setSettings(approved, { classifier: { enabled: false } });
  await h.run();
  h.setSettings(approved);
  h.context.isProjectTrusted = () => false;
  await h.run();
  h.context.isProjectTrusted = () => true;
  await h.run({ ...result(), input: { command: "run-fixture; other-command" } });
  h.context.cwd = "/other";
  await h.run();
  expect(h.requests).toHaveLength(0);
  expect(await readdir(h.root)).toEqual([]);
});

test("nested calls, media, non-Bash, failed or incomplete captures, and size bounds are excluded", async () => {
  const h = await harness();
  const withoutStructured = result();
  delete withoutStructured.structuredContent;
  const events: ToolResultEvent[] = [
    { ...result(), parentToolCallId: "codemode-parent" },
    { ...result(), toolName: "read" },
    { ...result(), isError: true },
    withoutStructured,
    { ...result(), structuredContent: { output: "different", truncated: false, exit_code: 0 } },
    { ...result(), structuredContent: { output, truncated: true, exit_code: 0 } },
    { ...result(), details: { fullOutputPath: "/untrusted/path" } },
    { ...result(), content: [{ type: "image", data: "AAAA", mimeType: "image/png" }] },
    result("short"),
    result(output.repeat(3)),
  ];
  for (const event of events) {
    const before = structuredClone(event);
    expect(await h.run(event)).toBeUndefined();
    expect(event).toEqual(before);
    expect(eligibleOutput(event)).toBeUndefined();
  }
  expect(h.requests).toHaveLength(0);
  expect(await readdir(h.root)).toEqual([]);
});

test("sensitive output is excluded before artifact storage and classifier requests", async () => {
  const h = await harness();
  const samples = [
    "API_KEY=fake-fixture",
    "Authorization: Bearer fake-token",
    "person@example.test",
    "-----BEGIN PRIVATE KEY-----",
    '"password": "fixture"',
    "https://name:pass@example.test/",
  ];
  for (const sample of samples) {
    expect(hasSensitiveText(sample)).toBe(true);
    await h.run(result(`${output}${sample}`));
  }
  expect(h.requests).toHaveLength(0);
  expect(await readdir(h.root)).toEqual([]);
});

test("provider failure retains all blocks and the complete original output", async () => {
  const h = await harness(async () => ({ ok: false, stage: "request", reason: "timeout" }));
  const event = result();
  expect(await h.run(event)).toBeUndefined();
  expect(h.records[0]).toMatchObject({
    outcome: "fallback",
    reason: "timeout",
    proposedOmittedBytes: 0,
  });
  expect(await readFile(String(h.records[0]?.artifactPath), "utf8")).toBe(output);
  expect(event).toEqual(result());
});

test("invalid scores and thrown requests fail without exposing exception text", async () => {
  for (const request of [
    async () => ({ ok: true as const, value: { answers: {} } }),
    async () => {
      throw new Error("sensitive provider body");
    },
  ]) {
    const h = await harness(request);
    expect(await h.run()).toBeUndefined();
    expect(h.records[0]).toMatchObject({ outcome: "fallback", reason: "pilot-error" });
    expect(JSON.stringify(h.records)).not.toContain("sensitive provider body");
  }
});

test("usage accounting changes no model-facing or structured data", async () => {
  const usage: Usage = {
    input: 5,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 7,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const h = await harness(async (_registry, input) => ({
    ok: true,
    value: { answers: scores(input) },
    usage,
  }));
  const event = { ...result(), usage };
  const patch = await h.run(event);
  expect(patch).toEqual({ usage: { ...usage, input: 10, output: 4, totalTokens: 14 } });
  expect(event.usage).toBe(usage);
});

test("attempt budget bounds disk and provider work and resets with session lifecycle", async () => {
  const h = await harness();
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await h.run();
  expect(h.requests).toHaveLength(MAX_ATTEMPTS);
  expect(await readdir(h.root)).toHaveLength(MAX_ATTEMPTS);
  await h.reset();
  await h.run();
  expect(h.requests).toHaveLength(MAX_ATTEMPTS + 1);
});

test("session replacement cancels in-flight work without appending into the new session", async () => {
  let entered: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const h = await harness(async (_registry, _input, options) => {
    entered?.();
    await new Promise<void>((resolve) =>
      options?.signal?.addEventListener("abort", () => resolve(), { once: true }),
    );
    return { ok: false, stage: "request", reason: "caller-cancellation" };
  });
  const pending = h.run();
  await started;
  expect(await h.run()).toBeUndefined();
  expect(h.requests).toHaveLength(1);
  await h.reset();
  expect(await pending).toBeUndefined();
  expect(h.records).toEqual([]);
});
