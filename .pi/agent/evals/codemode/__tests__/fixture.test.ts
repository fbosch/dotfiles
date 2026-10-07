import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import fixture from "../fixture";

type Handler = (event: unknown, ctx: ExtensionToolContext) => unknown | Promise<unknown>;
const contents = {
  "a.ts": "export const alpha = 1;\n",
  "b.ts": "export const beta = 2;\n",
  "c.ts": "export const gamma = 3;\n",
  "small.ts": "export const small = 4;\n",
  "large.ts": `export const large = 5;\n// BULK_CONTENT_OMIT ${"x".repeat(80_000)}\n`,
  "manifest.json": '{"files":["a.ts","b.ts"]}\n',
  "config.json": '{"enabled":false,"mode":"slow","keep":"untouched"}\n',
  "config-large.json": `${JSON.stringify({ enabled: false, mode: "slow", padding: "x".repeat(80_000) })}\n`,
};
const parallel =
  'const r = await Promise.allSettled([tools.read({path:"a.ts"}), tools.read({path:"b.ts"})]); text(r.map(x => x.status === "fulfilled" ? x.value.text : String(x.reason)));';
const cases = [
  { name: "independent", script: parallel, answer: "a.ts: alpha = 1; b.ts: beta = 2" },
  {
    name: "dependent",
    script:
      'const m = await tools.read({path:"manifest.json"}); const files = JSON.parse(m.lines[0].text).files; const r = await Promise.allSettled(files.map(path => tools.read({path}))); text(r.map(x => x.value.text));',
    answer: "a.ts: alpha = 1; b.ts: beta = 2",
  },
  {
    name: "rejected",
    script:
      'const r = await Promise.allSettled(["a.ts","b.ts","c.ts"].map(path => tools.read({path}))); text(r.map(x => x.status === "fulfilled" ? x.value.text : String(x.reason)));',
    answer: "a.ts: alpha = 1; c.ts: gamma = 3; b.ts: Permission denied",
  },
  {
    name: "tool-error",
    script:
      "const r = await Promise.allSettled([tools.check_one({}),tools.check_two({})]); text(r.map(x => x.value));",
    answer: "check_one: passed; check_two: failed: Invalid configuration",
  },
  {
    name: "mutations",
    script:
      'let c = JSON.parse((await tools.read({path:"config.json"})).lines[0].text); c.enabled=true; await tools.write({path:"config.json",content:JSON.stringify(c)}); c=JSON.parse((await tools.read({path:"config.json"})).lines[0].text); c.mode="fast"; await tools.write({path:"config.json",content:JSON.stringify(c)}); text(c);',
    answer: '{"enabled":true,"mode":"fast","keep":"untouched"}',
  },
  {
    name: "large",
    script:
      'const r = await Promise.allSettled(["large.ts","small.ts"].map(path => tools.read({path}))); text(r.map(x => ({path:x.value.path,line:x.value.lines[0]})));',
    answer: "large.ts aaaa: large = 5; small.ts aaaa: small = 4",
  },
  {
    name: "large-edit",
    script:
      'const r = await tools.read({path:"config-large.json"}); const c=JSON.parse(r.lines[0].text); c.enabled=true; const acknowledgement=JSON.parse(await tools.write({path:"config-large.json",content:JSON.stringify(c)+"\\n"})); if(!acknowledgement.ok)throw new Error("Write failed"); const back=JSON.parse((await tools.read({path:"config-large.json"})).lines[0].text); if(JSON.stringify(back)!==JSON.stringify(c))throw new Error("Read-back mismatch"); text({path:"config-large.json",enabled:back.enabled,verified:true});',
    answer: "config-large.json: enabled = true; preserved mode slow and padding; verified.",
  },
  { name: "single", answer: "alpha = 1" },
];

async function executeCase(
  name: string,
  script: string | undefined,
  answer: string,
  freezePromise = false,
) {
  const directory = mkdtempSync(join(tmpdir(), "codemode-fixture-test-"));
  const trace = join(directory, "trace.jsonl");
  const previous = {
    CODEMODE_TRACE: process.env.CODEMODE_TRACE,
    CODEMODE_WORK: process.env.CODEMODE_WORK,
    CODEMODE_CASE: process.env.CODEMODE_CASE,
  };
  Object.assign(process.env, {
    CODEMODE_TRACE: trace,
    CODEMODE_WORK: directory,
    CODEMODE_CASE: name,
  });
  for (const [path, value] of Object.entries(contents)) writeFileSync(join(directory, path), value);
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, Handler[]>();
  const branch: Array<{ type: "custom"; customType: string; data: unknown }> = [];
  let active: string[] = [];
  const pi = {
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    getSettings: () => ({}),
    getThinkingLevel: () => "low",
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => {
      active = names;
    },
    getAllTools: () => [...tools.values()],
    appendEntry: (customType: string, data: unknown) =>
      branch.push({ type: "custom", customType, data }),
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  } as unknown as ExtensionAPI;
  let nextId = 0;
  const emit = async (name: string, event: unknown) => {
    for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
  };
  const ctx = {
    cwd: directory,
    model: { provider: "fixture", id: "model" },
    isProjectTrusted: () => false,
    sessionManager: { getBranch: () => branch },
    get tools() {
      return [...tools.values()].filter((tool) => active.includes(tool.name));
    },
    async executeTool(name: string, args: Record<string, unknown>) {
      const tool = tools.get(name);
      if (!tool) throw new Error("Missing fixture tool");
      const id = `nested/${nextId++}`;
      await emit("tool_call", {
        toolName: name,
        toolCallId: id,
        parentToolCallId: "outer",
        input: args,
      });
      const result = await tool.execute(id, args, undefined, undefined, ctx);
      await emit("tool_result", {
        toolName: name,
        toolCallId: id,
        parentToolCallId: "outer",
        input: args,
        ...result,
        isError: false,
      });
      return { toolCall: { id, type: "toolCall", name, arguments: args }, result, isError: false };
    },
  } as unknown as ExtensionToolContext;
  try {
    fixture(pi);
    await emit("session_start", {});
    await emit("before_agent_start", {});
    const name = script === undefined ? "read" : "codemode";
    const tool = tools.get(name);
    if (!tool) throw new Error("Missing native codemode tool");
    const input = script === undefined ? { path: "a.ts" } : { code: script };
    await emit("tool_call", { toolName: name, toolCallId: "outer", input });
    if (freezePromise && typeof input.code === "string")
      input.code = `Object.freeze(globalThis.Promise);\n${input.code}`;
    const result = await tool.execute("outer", input, undefined, undefined, ctx);
    await emit("tool_result", {
      toolName: name,
      toolCallId: "outer",
      input,
      ...result,
      isError: result.isError ?? false,
    });
    await emit("message_end", {
      message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: answer }] },
    });
    await emit("session_shutdown", {});
    const expected = join(directory, "expected.json");
    writeFileSync(
      expected,
      JSON.stringify({
        case: process.env.CODEMODE_CASE,
        model: "fixture/model",
        thinking: "low",
        contents,
      }),
    );
    const check = join(import.meta.dir, "../check.py");
    const outcome = spawnSync(
      "python3",
      [
        "-c",
        `import importlib.util,json,sys;s=importlib.util.spec_from_file_location('grader',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.validate([json.loads(l) for l in open(sys.argv[2])],json.load(open(sys.argv[3])))`,
        check,
        trace,
        expected,
      ],
      { encoding: "utf8" },
    );
    return { status: outcome.status, error: outcome.stderr, events: readFileSync(trace, "utf8") };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const scenario of cases) {
  test(`native sandbox and deterministic grader accept ${scenario.name}`, async () => {
    const result = await executeCase(scenario.name, scenario.script, scenario.answer);
    expect(result.error).toBe("");
    expect(result.status).toBe(0);
  });
}

test("sequential reads fail event-order grading", async () => {
  const result = await executeCase(
    "independent",
    'text(await tools.read({path:"a.ts"})); text(await tools.read({path:"b.ts"}));',
    cases[0].answer,
  );
  expect(result.status).not.toBe(0);
  expect(result.error).toContain("Independent calls ran sequentially");
});

test("Promise.all and a dead allSettled mention do not pass", async () => {
  const result = await executeCase(
    "independent",
    'if(false){await Promise.allSettled([])}; const r=await Promise.all([tools.read({path:"a.ts"}),tools.read({path:"b.ts"})]);text(r.map(x=>x.text));',
    cases[0].answer,
  );
  expect(result.status).not.toBe(0);
  expect(result.error).toContain("No executed and completed allSettled batch");
});

test("printing duplicate bulk results fails output grading", async () => {
  const result = await executeCase(
    "large",
    'text(await Promise.allSettled([tools.read({path:"large.ts"}),tools.read({path:"small.ts"})]));',
    cases[5].answer,
  );
  expect(result.status).not.toBe(0);
  expect(result.error).toContain("Bulk output was printed or spilled");
});

test("batch instrumentation works with the native frozen Promise constructor", async () => {
  const result = await executeCase("independent", parallel, cases[0].answer, true);
  expect(result.error).toBe("");
  expect(result.status).toBe(0);
});

test("large edit rejects full intermediate reads and successful write acknowledgements", async () => {
  const scenario = cases[6];
  if (!scenario.script) throw new Error("Missing large-edit script");
  for (const output of ["text(r);", "text(acknowledgement);"]) {
    const script = scenario.script.replace("text({path:", `${output} text({path:`);
    const result = await executeCase(scenario.name, script, scenario.answer, true);
    expect(result.status).not.toBe(0);
    expect(result.error).toContain("Large edit printed intermediate or full successful output");
  }
});

test("large edit rejects changes to unrelated data", async () => {
  const scenario = cases[6];
  if (!scenario.script) throw new Error("Missing large-edit script");
  const result = await executeCase(
    scenario.name,
    scenario.script.replace("c.enabled=true;", 'c.padding=""; c.enabled=true;'),
    scenario.answer,
    true,
  );
  expect(result.status).not.toBe(0);
  expect(result.error).toContain("Large edit changed unrelated fields");
});

test("model-visible accounting excludes successful nested results", async () => {
  const scenario = cases[6];
  const result = await executeCase(scenario.name, scenario.script, scenario.answer, true);
  const events: Array<{ kind: string; tool?: string; text?: string }> = result.events
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const visible = events.filter((event) => event.kind === "model-output");
  expect(visible).toHaveLength(1);
  expect(visible[0].tool).toBe("codemode");
  expect(visible[0].text?.length).toBeLessThan(1000);
});
