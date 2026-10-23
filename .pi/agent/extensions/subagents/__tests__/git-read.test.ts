import { expect, test } from "bun:test";
import gitRead from "../git-read";

test("read-only Git diff uses fixed arguments and disables external drivers", async () => {
  let definition: Parameters<Parameters<typeof gitRead>[0]["registerTool"]>[0] | undefined;
  const calls: unknown[][] = [];
  gitRead({
    registerTool(tool) { definition = tool; },
    async exec(...args) { calls.push(args); return { code: 0, stdout: "diff evidence", stderr: "", killed: false }; },
  });
  const signal = new AbortController().signal;
  if (!definition) throw new Error("Tool not registered");
  const context = { cwd: "/fixture" } as Parameters<typeof definition.execute>[4];
  const result = await definition.execute("diff", { staged: true }, signal, undefined, context);
  expect(calls).toEqual([["git", ["--no-pager", "diff", "--no-ext-diff", "--no-textconv", "--cached", "--"], { cwd: "/fixture", signal }]]);
  expect(result.content).toEqual([{ type: "text", text: "diff evidence" }]);
});
