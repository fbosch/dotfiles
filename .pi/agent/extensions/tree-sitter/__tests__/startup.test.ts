import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { loadSyntaxRuntime } from "../src/runtime";

test("registers tools and the write guard without importing web-tree-sitter", async () => {
  const child = Bun.spawn(
    [process.execPath, "run", fileURLToPath(new URL("./fixtures/startup.ts", import.meta.url))],
    { stderr: "pipe", stdout: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(JSON.parse(stdout)).toEqual([
    "list_symbols",
    "find_definition",
    "find_callers",
    "get_symbol_body",
    "find_callees",
  ]);
});

test("shares one runtime import across concurrent and subsequent operations", async () => {
  const first = loadSyntaxRuntime();
  expect(loadSyntaxRuntime()).toBe(first);
  const runtime = await first;
  expect(await loadSyntaxRuntime()).toBe(runtime);
});
