import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverScripts } from "../catalog";
import { importScripts, registerScript } from "../import-scripts";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

async function harness() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "dekit-import-")));
  directories.push(root);
  await writeFile(join(root, "Justfile"), "hello:\n  echo never executed\n");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      packageManager: "npm@10",
      scripts: { dev: "never execute during import" },
    }),
  );
  const calls: Array<{ command: string; args: string[] }> = [];
  const state = { code: 0, killed: false, response: '{"matched":1}' };
  const executor: Pick<ExtensionAPI, "exec"> = {
    async exec(command, args) {
      calls.push({ command, args });
      const stdout =
        command === "just"
          ? JSON.stringify({
              aliases: {},
              recipes: {
                hello: { name: "hello", namepath: "hello", private: false, parameters: [] },
                build: {
                  name: "build",
                  namepath: "build",
                  private: false,
                  parameters: [{ name: "target", kind: "singular", default: null }],
                },
                hidden: { name: "hidden", private: true },
              },
            })
          : state.response;
      return {
        stdout,
        stderr: "fixture registration failure",
        code: command === "just" ? 0 : state.code,
        killed: state.killed,
      };
    },
  };
  return { root, calls, state, executor };
}

test("imports both catalogs as idle native tasks with readable labels and no project config", async () => {
  const h = await harness();
  const result = await importScripts(h.executor, h.root);
  expect(result.project).toBe(h.root);
  expect(result.imported).toBe(3);
  expect(h.calls[0]).toEqual({
    command: "just",
    args: ["--no-dotenv", "--justfile", join(h.root, "Justfile"), "--json"],
  });
  const registrations = h.calls.slice(1);
  expect(registrations.map((call) => call.args[3])).toEqual(["register", "register", "register"]);
  expect(registrations.map((call) => call.args[call.args.indexOf("--label") + 1])).toEqual([
    "just:build (requires: target)",
    "just:hello",
    "package:dev",
  ]);
  expect(registrations.every((call) => !call.args.includes("--start"))).toBe(true);
  expect(registrations.map((call) => call.args[4])).toEqual(result.tasks);
  expect((await readdir(h.root)).sort()).toEqual(["Justfile", "package.json"]);
});

test("explicit start shares the import task ID and preserves literal npm arguments", async () => {
  const h = await harness();
  const imported = await importScripts(h.executor, h.root);
  const importedTask = imported.tasks[2];
  if (importedTask === undefined) throw new Error("missing imported task");
  const script = (await discoverScripts(h.executor, h.root)).scripts.find(
    (item) => item.id === "package:dev",
  );
  if (script === undefined) throw new Error("missing package fixture");
  const reused = await registerScript(h.executor, h.root, script, { start: true });
  expect(reused).toBe(importedTask);
  const variant = await registerScript(h.executor, h.root, script, {
    arguments: ["a b", "$(touch /tmp/no)"],
    start: true,
  });
  expect(variant).not.toBe(reused);
  expect(h.calls.at(-1)?.args).toEqual([
    "-C",
    h.root,
    "--json",
    "register",
    variant,
    "--cwd",
    h.root,
    "--label",
    "package:dev",
    "--start",
    "--",
    "npm",
    "run",
    "dev",
    "--",
    "a b",
    "$(touch /tmp/no)",
  ]);
});

test("canonicalizes symlink roots before deriving Just task identity", async () => {
  const h = await harness();
  const link = `${h.root}-link`;
  await symlink(h.root, link);
  directories.push(link);
  const original = await importScripts(h.executor, h.root);
  const alias = await importScripts(h.executor, link);
  expect(alias).toEqual(original);
});

test("stops catalog import at a native registration failure without executing a recipe", async () => {
  const h = await harness();
  h.state.code = 1;
  await expect(importScripts(h.executor, h.root)).rejects.toThrow("fixture registration failure");
  expect(h.calls.map((call) => call.command)).toEqual(["just", "dekit"]);
  expect(h.calls[1]?.args[3]).toBe("register");
});

test.each(["not JSON", '{"matched":0}', '{"matched":2}'])(
  "rejects an invalid registration acknowledgement: %s",
  async (response) => {
    const h = await harness();
    const script = (await discoverScripts(h.executor, h.root)).scripts[0];
    if (script === undefined) throw new Error("missing fixture");
    h.state.response = response;
    await expect(registerScript(h.executor, h.root, script)).rejects.toThrow(
      "Invalid dekit register response",
    );
  },
);

test("cancellation prevents discovery and native registration", async () => {
  const h = await harness();
  const controller = new AbortController();
  controller.abort();
  await expect(importScripts(h.executor, h.root, controller.signal)).rejects.toThrow();
  expect(h.calls).toEqual([]);
});
