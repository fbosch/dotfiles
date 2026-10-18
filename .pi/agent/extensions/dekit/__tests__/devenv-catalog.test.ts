import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  discoverScripts,
  hasScriptCatalog,
  inspectScript,
  isManagedTask,
  scriptCommand,
  taskPath,
} from "../catalog";
import { importScripts } from "../import-scripts";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

async function harness() {
  const root = await mkdtemp(join(tmpdir(), "dekit-devenv-"));
  directories.push(root);
  await writeFile(join(root, "devenv.nix"), "# Metadata fixture; never evaluated by these tests\n");
  const state = {
    stdout: JSON.stringify([
      {
        name: "test:unit",
        description: "Run unit tests",
        type: "oneshot",
        after: ["test:generate"],
        before: [],
        hasExec: true,
        hasStatus: false,
      },
      { name: "dev:server", description: "Run the dev server", type: "process" },
      { name: "devenv:enterShell", description: "", type: "oneshot", hasExec: false },
    ]),
    code: 0,
    killed: false,
    onList: () => {},
  };
  const calls: Array<{ command: string; args: string[]; timeout?: number }> = [];
  const executor: Pick<ExtensionAPI, "exec"> = {
    async exec(command, args, options) {
      calls.push({
        command,
        args,
        ...(options?.timeout === undefined ? {} : { timeout: options.timeout }),
      });
      if (command === "devenv") {
        state.onList();
        return {
          stdout: state.stdout,
          stderr: "private fixture diagnostic",
          code: state.code,
          killed: state.killed,
        };
      }
      if (command === "just") {
        return {
          stdout: JSON.stringify({
            aliases: {},
            recipes: {
              hello: { name: "hello", namepath: "hello", private: false, parameters: [] },
            },
          }),
          stderr: "",
          code: 0,
          killed: false,
        };
      }
      if (command !== "dekit") throw new Error(`Unexpected command: ${command}`);
      return { stdout: '{"matched":1}', stderr: "", code: 0, killed: false };
    },
  };
  return { root, executor, calls, state };
}

test("discovers the evaluated devenv task catalog without running tasks or shell hooks", async () => {
  const h = await harness();
  expect(await hasScriptCatalog(h.root)).toBe(true);
  const catalog = await discoverScripts(h.executor, h.root);
  expect(catalog.warnings).toEqual([]);
  expect(catalog.scripts.map((script) => script.id)).toEqual([
    "devenv:test:unit",
    "devenv:dev:server",
    "devenv:devenv:enterShell",
  ]);
  expect(h.calls).toEqual([
    { command: "devenv", args: ["tasks", "list", "--json", "--no-tui"], timeout: 30_000 },
  ]);
  const script = catalog.scripts[0];
  if (script === undefined) throw new Error("Missing discovered task");
  expect(inspectScript(script)).toEqual({
    id: "devenv:test:unit",
    source: "devenv",
    description: "Run unit tests",
    parameters: null,
    tags: [],
  });
  expect(script.command).toEqual([
    "devenv",
    "tasks",
    "run",
    "--no-tui",
    "--mode",
    "before",
    "--",
    "test:unit",
  ]);
  const path = taskPath(script, script.command);
  expect(path).toMatch(/^devenv\/[a-f0-9]{24}$/u);
  expect(isManagedTask(path)).toBe(true);
});

test("imports devenv tasks idle alongside Just and package scripts", async () => {
  const h = await harness();
  await writeFile(join(h.root, "justfile"), "hello:\n  echo fixture\n");
  await writeFile(
    join(h.root, "package.json"),
    JSON.stringify({ scripts: { dev: "never execute" } }),
  );
  const result = await importScripts(h.executor, h.root);
  expect(result.imported).toBe(5);
  expect(result.tasks.map((path) => path.split("/")[0])).toEqual([
    "just",
    "package",
    "devenv",
    "devenv",
    "devenv",
  ]);
  const registrations = h.calls.filter((call) => call.command === "dekit");
  expect(registrations).toHaveLength(5);
  expect(
    registrations.every((call) => call.args[3] === "register" && !call.args.includes("--start")),
  ).toBe(true);
  expect(h.calls.filter((call) => call.command === "devenv").map((call) => call.args)).toEqual([
    ["tasks", "list", "--json", "--no-tui"],
  ]);
  expect((await readdir(h.root)).sort()).toEqual(["devenv.nix", "justfile", "package.json"]);
});

test("reports unavailable devenv evaluation while preserving other catalogs", async () => {
  const h = await harness();
  await writeFile(join(h.root, "package.json"), JSON.stringify({ scripts: { check: "true" } }));
  h.state.code = 1;
  const catalog = await discoverScripts(h.executor, h.root);
  expect(catalog.scripts.map((script) => script.id)).toEqual(["package:check"]);
  expect(catalog.warnings).toHaveLength(1);
  expect(catalog.warnings[0]).toContain("devenv");
  expect(catalog.warnings[0]).not.toContain("private fixture diagnostic");
  const result = await importScripts(h.executor, h.root);
  expect(result.imported).toBe(1);
  expect(result.warnings).toEqual(catalog.warnings);
});

test.each([
  "invalid JSON",
  '{"tasks":[]}',
  '[{"name":"test:unit","description":42}]',
  '[{"name":"test:unit","description":"a"},{"name":"test:unit","description":"b"}]',
])("warns on invalid devenv metadata without registering tasks: %s", async (stdout) => {
  const h = await harness();
  h.state.stdout = stdout;
  const result = await importScripts(h.executor, h.root);
  expect(result.imported).toBe(0);
  expect(result.warnings).toHaveLength(1);
  expect(h.calls.map((call) => call.command)).toEqual(["devenv"]);
});

test("treats task metadata as data and ignores unsafe task identifiers", async () => {
  const h = await harness();
  h.state.stdout = JSON.stringify([
    { name: "", description: "empty" },
    { name: "--help", description: "option" },
    { name: "bad\0name", description: "NUL" },
    { name: "test:literal", description: "Literal task", command: "never execute this metadata" },
  ]);
  const catalog = await discoverScripts(h.executor, h.root);
  expect(catalog.scripts.map((script) => script.id)).toEqual(["devenv:test:literal"]);
  expect(catalog.scripts[0]?.command.at(-1)).toBe("test:literal");
  expect(h.calls).toHaveLength(1);
});

test("passes explicit devenv inputs literally while keeping the task and dependency mode fixed", async () => {
  const h = await harness();
  const script = (await discoverScripts(h.executor, h.root)).scripts[0];
  if (script === undefined) throw new Error("Missing discovered task");
  expect(
    scriptCommand(script, [
      "--input",
      "message=a b",
      "--input-json",
      '{"text":"$(touch /tmp/no)"}',
    ]),
  ).toEqual([
    "devenv",
    "tasks",
    "run",
    "--no-tui",
    "--mode",
    "before",
    "--input",
    "message=a b",
    "--input-json",
    '{"text":"$(touch /tmp/no)"}',
    "--",
    "test:unit",
  ]);
  for (const args of [["other:task"], ["--mode", "all"], ["--input"], ["--input-json"]]) {
    expect(() => scriptCommand(script, args)).toThrow("devenv task inputs");
  }
});

test("cancellation during devenv discovery prevents idle registration", async () => {
  const h = await harness();
  const controller = new AbortController();
  h.state.onList = () => controller.abort();
  await expect(importScripts(h.executor, h.root, controller.signal)).rejects.toThrow();
  expect(h.calls.map((call) => call.command)).toEqual(["devenv"]);
});
