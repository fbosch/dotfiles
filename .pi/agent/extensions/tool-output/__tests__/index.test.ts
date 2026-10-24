import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  createBashTool,
  createReadTool,
  discoverAndLoadExtensions,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolResultEvent,
  type ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import { convertMcpResult } from "@earendil-works/pi-coding-agent/dist/extensions/mcp/tools.js";
import { registerToolOutput } from "../index";
import {
  eligibleCapture,
  MAX_PREVIEW_BYTES,
  MAX_SESSION_BYTES,
  makePreview,
  outputEnabled,
} from "../policy";
import { type createOutputSearchTool, SEARCH_TOOL } from "../search";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const output = Array.from({ length: 600 }, (_, i) => `Progress ${i}: æ ø å 😀\r\n`).join("");
const project = { toolOutput: { enabled: true } };
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
type Handler = (
  event: ToolResultEvent,
  ctx: ExtensionContext,
) => Promise<ToolResultEventResult | undefined>;
async function harness() {
  const root = await mkdtemp(join(tmpdir(), "tool-output-test-"));
  roots.push(root);
  const records: Record<string, unknown>[] = [];
  const entries: unknown[] = [];
  let searchTool: ReturnType<typeof createOutputSearchTool> | undefined;
  const handlers = new Map<string, Handler>();
  let settings: { global: unknown; project: unknown } = { global: {}, project };
  let afterSettings: (() => void) | undefined;
  const context = {
    cwd: "/work",
    isProjectTrusted: () => true,
    signal: undefined,
    hasUI: false,
    sessionManager: {
      getBranch: () => entries,
      getSessionId: () => "test-session",
    },
  } as unknown as ExtensionContext;
  let readerAvailable = true;
  const api = {
    getActiveTools: () => (readerAvailable ? ["read", SEARCH_TOOL] : []),
    registerTool: (tool: ReturnType<typeof createOutputSearchTool>) => {
      searchTool = tool;
    },
    getAllTools: () => (readerAvailable ? [{ name: "read", exposure: "direct" }] : []),
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    appendEntry: (name: string, data: Record<string, unknown>) => {
      records.push(data);
      entries.push({ type: "custom", customType: name, data });
    },
  } as unknown as Pick<
    ExtensionAPI,
    "on" | "appendEntry" | "getAllTools" | "getActiveTools" | "registerTool"
  >;
  registerToolOutput(api, {
    settings: () => {
      const current = settings;
      afterSettings?.();
      return current;
    },
    artifactRoot: () => root,
  });
  return {
    root,
    context,
    records,
    searchTool: () => searchTool,
    restoreBranch: () => entries.splice(0, entries.length, ...structuredClone(entries)),
    disableReader: () => {
      readerAvailable = false;
    },
    setSettings: (global: unknown, p: unknown = project) => {
      settings = { global, project: p };
    },
    onSettings: (fn: () => void) => {
      afterSettings = fn;
    },
    run: (event = result()) => handlers.get("tool_result")?.(event, context),
    reset: () => handlers.get("session_start")?.(result(), context),
  };
}

test("requires explicit trusted-project opt-in and permits a global veto", () => {
  expect(outputEnabled({}, {}, true)).toBe(false);
  expect(outputEnabled({}, project, true)).toBe(true);
  expect(outputEnabled({ toolOutput: { enabled: true } }, {}, true)).toBe(false);
  expect(outputEnabled({ toolOutput: { enabled: false } }, project, true)).toBe(false);
  expect(outputEnabled({}, project, false)).toBe(false);
  for (const bad of [
    null,
    { toolOutput: null },
    { toolOutput: { enabled: "yes" } },
    { toolOutput: { enabled: true, typo: 1 } },
  ])
    expect(() => outputEnabled({}, bad, true)).toThrow();
});

test("preview retains boundary and diagnostic lines verbatim with context and omission ranges", () => {
  const lines = output.match(/[^\n]*\n/gu) ?? [];
  lines[200] = "CONSTRAINT: staging only; schema 7 required\r\n";
  lines[400] = "REVISION: readiness is NO; earlier cache was stale\r\n";
  const text = `${lines.join("")}FINAL: æøå 😀`;
  const p = makePreview(text, "/private/output.txt");
  expect(p).toBeDefined();
  if (!p) throw new Error("Missing preview");
  for (const i of [0, 199, 200, 201, 399, 400, 401, 599]) expect(p.text).toContain(lines[i] ?? "");
  expect(p.text).toContain("FINAL: æøå 😀");
  expect(p.text).toContain("[Collapsed repeated progress lines 5-199]");
  expect(p.text).toContain("Only repeated progress templates collapsed");
  expect(p.text).toContain("offset: <line>, limit: 100");
  expect(Buffer.byteLength(p.text)).toBeLessThan(MAX_PREVIEW_BYTES);
  const numbers = p.ranges.flatMap((r) =>
    Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i),
  );
  expect(new Set(numbers).size).toBe(p.selectedLines);
  expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
});

test("dense diagnostics, oversized lines, and low-value reductions retain original output", () => {
  expect(makePreview("WARNING: preserve all evidence\n".repeat(500), "/artifact")).toBeUndefined();
  expect(makePreview("x".repeat(9000), "/artifact")).toBeUndefined();
  expect(makePreview("short\n", "/artifact")).toBeUndefined();
});

test("native Bash preview preserves structured identity, details, status, usage, and exact private artifact", async () => {
  const h = await harness();
  const tool = createBashTool("/work", {
    operations: {
      exec: async (_command, _cwd, { onData }) => {
        onData(Buffer.from(output));
        return { exitCode: 0 };
      },
    },
  });
  const native = await tool.execute("native-call", { command: "arbitrary-successful-command" });
  const event: ToolResultEvent = { ...result(), ...native, isError: native.isError === true };
  const before = structuredClone(event);
  const modified = await h.run(event);
  expect(modified?.content).toBeDefined();
  expect(modified?.structuredContent).toBe(event.structuredContent);
  expect(event).toEqual(before);
  const combined = { ...event, ...modified };
  expect(combined.details).toBe(event.details);
  expect(combined.usage).toBe(event.usage);
  expect(combined.isError).toBe(false);
  const artifact = String(h.records[0]?.artifactPath);
  expect(await readFile(artifact)).toEqual(Buffer.from(output));
  expect((await stat(dirname(artifact))).mode & 0o777).toBe(0o700);
  expect((await stat(artifact)).mode & 0o777).toBe(0o600);
  expect((await stat(join(dirname(artifact), "report.json"))).mode & 0o777).toBe(0o600);
  expect(
    Buffer.byteLength(combined.content[0]?.type === "text" ? combined.content[0].text : ""),
  ).toBeLessThan(Buffer.byteLength(output) * 0.75);
  expect(JSON.stringify(h.records)).not.toContain("Progress");
});

test("existing paginated reader retrieves omitted lines after lifecycle reset", async () => {
  const h = await harness();
  await h.run();
  const artifact = String(h.records[0]?.artifactPath);
  await h.reset();
  const read = createReadTool(h.root);
  const page = await read.execute("retrieve", { path: artifact, offset: 200, limit: 3 });
  const text = page.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  expect(text).toContain("Progress 199: æ ø å 😀");
  expect(text).toContain("Progress 201: æ ø å 😀");
  expect(text).not.toContain("Progress 202:");
});

test("off, untrusted, malformed config, and unavailable reader do not alter results or store output", async () => {
  const h = await harness();
  for (const [global, p] of [
    [{}, {}],
    [{ toolOutput: { enabled: false } }, project],
    [{}, { toolOutput: null }],
  ]) {
    h.setSettings(global, p);
    expect(await h.run()).toBeUndefined();
  }
  h.setSettings({});
  h.context.isProjectTrusted = () => false;
  expect(await h.run()).toBeUndefined();
  h.context.isProjectTrusted = () => true;
  h.disableReader();
  expect(await h.run()).toBeUndefined();
  expect(await readdir(h.root)).toEqual([]);
});

test("nested calls, source tools, media, inconsistent statuses, incomplete captures, controls, and sizes are unchanged", async () => {
  const h = await harness();
  const noStructured = result();
  delete noStructured.structuredContent;
  const events: ToolResultEvent[] = [
    noStructured,
    { ...result(), parentToolCallId: "parent" },
    { ...result(), toolName: "read" },
    { ...result(), isError: true },
    { ...result(), structuredContent: { output, exit_code: 1, truncated: false } },
    { ...result(), structuredContent: { output, exit_code: 0, truncated: true } },
    { ...result(), structuredContent: { output: "different", exit_code: 0, truncated: false } },
    {
      ...result(),
      structuredContent: { output, exit_code: 0, truncated: false, full_output_path: "/untrusted" },
    },
    { ...result(), details: { fullOutputPath: "/untrusted" } },
    { ...result(), details: { truncation: {} } },
    { ...result(), content: [{ type: "image", data: "AAAA", mimeType: "image/png" }] },
    result("short"),
    result(output.repeat(20)),
    result(`${output}\u0000`),
    result(`${output}\ud800`),
  ];
  for (const event of events) {
    expect(eligibleCapture(event)).toBeUndefined();
    expect(await h.run(event)).toBeUndefined();
  }
  expect(await readdir(h.root)).toEqual([]);
});

test("sensitive content and commands are excluded before disk storage", async () => {
  const h = await harness();
  for (const suffix of [
    "password=hunter2",
    "Bearer abcdefghijk",
    "person@example.com",
    "-----BEGIN PRIVATE KEY-----",
  ]) {
    expect(await h.run(result(output + suffix))).toBeUndefined();
  }
  expect(await h.run({ ...result(), input: { command: "echo password=abc" } })).toBeUndefined();
  expect(await readdir(h.root)).toEqual([]);
});

test("storage failure returns original result and only generic metadata", async () => {
  const h = await harness();
  await rm(h.root, { recursive: true });
  const event = result();
  const before = structuredClone(event);
  expect(await h.run(event)).toBeUndefined();
  expect(event).toEqual(before);
  expect(h.records).toEqual([{ version: 2, outcome: "unchanged", reason: "preview-error" }]);
});

test("session replacement and cancellation cannot publish stale previews", async () => {
  const h = await harness();
  const pending = h.run();
  await h.reset();
  expect(await pending).toBeUndefined();
  expect(h.records).toEqual([]);
  const controller = new AbortController();
  controller.abort();
  Object.assign(h.context, { signal: controller.signal });
  expect(await h.run()).toBeUndefined();
});

test("settings and cwd are rechecked before publishing a preview", async () => {
  for (const change of ["settings", "cwd"]) {
    const h = await harness();
    h.onSettings(() => {
      if (change === "settings") h.setSettings({}, {});
      else h.context.cwd = "/other";
    });
    expect(await h.run()).toBeUndefined();
    expect(h.records).toEqual([]);
  }
});

test("byte reservations bound parallel disk work and reset on session lifecycle", async () => {
  const h = await harness();
  const count = Math.floor(MAX_SESSION_BYTES / Buffer.byteLength(output)) + 4;
  const results = await Promise.all(Array.from({ length: count }, () => h.run()));
  const modified = results.filter(Boolean).length;
  expect(modified).toBe(Math.floor(MAX_SESSION_BYTES / Buffer.byteLength(output)));
  expect(h.records.reduce((sum, r) => sum + Number(r.originalBytes), 0)).toBeLessThanOrEqual(
    MAX_SESSION_BYTES,
  );
  expect(await h.run()).toBeUndefined();
  await h.reset();
  expect(await h.run()).toBeDefined();
});

test("installed hashline reader retrieves preview artifacts with paginated anchor-bearing rows", async () => {
  const h = await harness();
  await h.run();
  const artifact = String(h.records[0]?.artifactPath);
  const agentRoot = resolve(import.meta.dir, "../../..");
  const loaded = await discoverAndLoadExtensions(
    [join(agentRoot, "npm/node_modules/pi-hashline-edit-pro/index.ts")],
    h.root,
    h.root,
  );
  expect(loaded.errors).toEqual([]);
  const read = loaded.extensions[0]?.tools.get("read");
  if (!read) throw new Error("Installed hashline read unavailable");
  const page = await read.definition.execute(
    "page",
    { path: artifact, offset: 200, limit: 3 },
    undefined,
    undefined,
    {
      ...h.context,
      tools: [],
      executeTool: async () => {
        throw new Error("No nested tool execution in reader test");
      },
    },
  );
  const text = page.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  expect(text).toContain("Progress 199: æ ø å 😀");
  expect(text).toContain("Progress 201: æ ø å 😀");
  expect(text).not.toContain("Progress 202:");
  expect(text).toMatch(/[a-z]{5}│/u);
}, 20_000);

test("Pi discovers the tool-output entry point and registers artifact search", async () => {
  const h = await harness();
  const entry = resolve(import.meta.dir, "../index.ts");
  const loaded = await discoverAndLoadExtensions([entry], h.root, h.root);
  expect(loaded.errors).toEqual([]);
  expect(loaded.extensions).toHaveLength(1);
  expect(loaded.extensions[0]?.tools.get("tool_output_search")).toBeDefined();
}, 20_000);
test("captured artifacts remain searchable from restored persisted branch entries", async () => {
  const h = await harness();
  await h.run();
  const report = h.records[0];
  if (!report) throw new Error("Capture did not publish a persisted proof");
  const path = String(report.artifactPath);
  const tool = h.searchTool();
  if (!tool) throw new Error("Search tool was not registered");

  h.restoreBranch();
  const result = await tool.execute(
    "search",
    { path, queries: ["Progress 257: æ ø å 😀"] },
    undefined,
    undefined,
    h.context,
  );
  expect(result.structuredContent.matchingLines).toBe(1);
  expect(result.structuredContent.excerpts[0]?.text).toContain("Progress 257: æ ø å 😀");
});

test("mixed fixture retains buried constraints and revisions without retaining whole progress blocks", async () => {
  const headings = [
    "SYNTHETIC CASE mixed. A staged deployment simulation. Exit zero means capture succeeded.",
    "Progress only. Object scanning is underway; this block contains no outcome.",
    "CONSTRAINT: Run only on the staging host. Database schema 7 is required; schema 6 is incompatible.",
    "Progress only. Artifact enumeration continues; counters do not establish readiness.",
    "REVISION: Earlier readiness was based on stale cache data. Current readiness is NO; production release is prohibited.",
    "FINAL: Simulation complete. Use the current readiness and host/schema constraints above.",
  ];
  const text = headings
    .map((heading, i) =>
      Array.from(
        { length: 20 },
        (_, j) =>
          `${(j === 0 ? heading : `Progress block ${i}, tick ${j}: synthetic objects enumerated; no additional findings.`).padEnd(199, " ")}\n`,
      ).join(""),
    )
    .join("");
  const h = await harness();
  const start = performance.now();
  const changed = await h.run(result(text));
  const elapsedMs = performance.now() - start;
  const preview = changed?.content?.[0];
  if (preview?.type !== "text") throw new Error("Fixture was not previewed");
  expect(await readFile(String(h.records[0]?.artifactPath), "utf8")).toBe(text);
  expect(preview.text).toContain(headings[2] ?? "");
  expect(preview.text).toContain(headings[4] ?? "");
  expect(preview.text).toContain(headings[5] ?? "");
  expect(Buffer.byteLength(preview.text)).toBeLessThan(6000);
  console.info(
    JSON.stringify({
      fixture: "mixed",
      originalBytes: Buffer.byteLength(text),
      previewBytes: Buffer.byteLength(preview.text),
      elapsedMs,
      classifierCalls: 0,
    }),
  );
});

test("all unrecognized lines survive, including unmarked identifiers, measurements, and contradictory observations", () => {
  const lines = output.match(/[^\n]*\n/gu) ?? [];
  const evidence = [
    "artifact = pine-7631\r\n",
    "Observation 2 supersedes 1: allowed=false; host=staging\r\n",
    "adjustment amount=-11\r\n",
    "build/cache/entry-572: retained\r\n",
    "Latency p99 943ms\r\n",
  ];
  evidence.forEach((line, i) => {
    lines[60 + i * 90] = line;
  });
  const preview = makePreview(lines.join(""), "/private/output.txt");
  expect(preview).toBeDefined();
  for (const line of evidence) expect(preview?.text).toContain(line);
});

test("progress payload changes, diagnostics, and counter resets are never masked", () => {
  for (const special of [
    "Progress 300: checksum=9472\r\n",
    "Progress 300: value changed to 19\r\n",
    "Progress 300: WARNING replica unavailable\r\n",
  ]) {
    const lines = output.match(/[^\n]*\n/gu) ?? [];
    lines[300] = special;
    expect(makePreview(lines.join(""), "/private/output.txt")?.text).toContain(special);
  }
  const reset = Array.from({ length: 300 }, (_, i) => `Progress ${i % 40}: waiting\n`).join("");
  expect(makePreview(reset, "/private/output.txt")).toBeUndefined();
  const measurements = Array.from(
    { length: 400 },
    (_, i) => `Progress ${i}: measured ${i * 7}ms\n`,
  ).join("");
  expect(makePreview(measurements, "/private/output.txt")).toBeUndefined();
});

test("novel output that does not fit is unchanged rather than reduced to head and tail", () => {
  const unique = Array.from({ length: 400 }, (_, i) => `record ${i}: measurement=${i * 13}\n`).join(
    "",
  );
  expect(makePreview(unique, "/private/output.txt")).toBeUndefined();
  const rare = `${output}scan 1: unusual\nscan 2: unusual\n`;
  expect(makePreview(rare, "/private/output.txt")?.text).toContain("scan 1: unusual");
});

test("failed native Bash keeps exact failure status, output artifact, and structured data", async () => {
  const h = await harness();
  const raw = `${output}ERROR: replica lag; do not roll out\n`;
  const native = await createBashTool("/work", {
    operations: {
      exec: async (_command, _cwd, { onData }) => {
        onData(Buffer.from(raw));
        return { exitCode: 7 };
      },
    },
  }).execute("failed", { command: "synthetic-failure" });
  const event: ToolResultEvent = { ...result(), ...native, isError: native.isError === true };
  const changed = await h.run(event);
  const combined = { ...event, ...changed };
  expect(combined.isError).toBe(true);
  expect(combined.structuredContent).toBe(native.structuredContent);
  const text = changed?.content?.[0];
  if (text?.type !== "text") throw new Error("Failure capture was not previewed");
  expect(text.text).toContain("isError=true; exitCode=7");
  expect(text.text).toContain("ERROR: replica lag; do not roll out");
  expect(text.text).toContain("Command exited with code 7");
  const original = native.content[0];
  if (original?.type !== "text") throw new Error("Missing native failure text");
  expect(await readFile(String(h.records[0]?.artifactPath), "utf8")).toBe(original.text);
  expect(h.records[0]?.exitCode).toBe(7);
});

test("native MCP success and error text preserve the entire CallToolResult and truthful capture scope", async () => {
  for (const isError of [false, true]) {
    const h = await harness();
    const raw = {
      content: [{ type: "text" as const, text: `${output}artifact=oak-637\n` }],
      structuredContent: { ticket: 17, flags: ["hold"] },
      isError,
    };
    const native = await convertMcpResult("fixture", "inspect", raw);
    const event: ToolResultEvent = {
      ...result(),
      ...native,
      toolName: "mcp__fixture__inspect",
      input: { scope: "public-fixture" },
      isError: native.isError === true,
    };
    const before = structuredClone(event);
    const changed = await h.run(event);
    const combined = { ...event, ...changed };
    const text = changed?.content?.[0];
    if (text?.type !== "text") throw new Error("MCP text was not previewed");
    expect(text.text).toContain(`MCP output; isError=${isError}`);
    expect(text.text).toContain("artifact=oak-637");
    expect(event).toEqual(before);
    expect(combined.structuredContent).toBe(native.structuredContent);
    expect(combined.isError).toBe(isError);
    expect(combined.details).toBe(native.details);
    expect(h.records[0]?.coverage).toBe("received-single-text-block");
    expect(h.records[0]?.toolName).toBe("mcp__fixture__inspect");
    expect(await readFile(String(h.records[0]?.artifactPath), "utf8")).toBe(
      raw.content[0]?.text ?? "",
    );
  }
});

test("already-offloaded, multi-block, redacted, or mismatched MCP results remain unchanged", async () => {
  const h = await harness();
  const native = await convertMcpResult("fixture", "inspect", {
    content: [{ type: "text", text: output }],
  });
  const event: ToolResultEvent = {
    ...result(),
    ...native,
    toolName: "mcp__fixture__inspect",
    input: {},
    isError: false,
  };
  const offloaded = await convertMcpResult(
    "fixture",
    "inspect",
    { content: [{ type: "text", text: output.repeat(3) }] },
    { saveOutput: async () => "/untrusted/output.txt" },
  );
  const multiple = await convertMcpResult("fixture", "inspect", {
    content: [
      { type: "text", text: output },
      { type: "text", text: "second block" },
    ],
  });
  for (const candidate of [
    { ...event, ...offloaded },
    { ...event, ...multiple },
    {
      ...event,
      content: [{ type: "text" as const, text: output.replace("Progress", "Redacted") }],
    },
    { ...event, isError: true },
    { ...event, details: undefined },
    { ...event, parentToolCallId: "codemode" },
  ]) {
    expect(eligibleCapture(candidate)).toBeUndefined();
    expect(await h.run(candidate)).toBeUndefined();
  }
  expect(await readdir(h.root)).toEqual([]);
});
