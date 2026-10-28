import { expect, test } from "bun:test";
import { resolve } from "node:path";

const node = Bun.which("node");
const loader = Bun.resolveSync(
  "@earendil-works/pi-coding-agent/dist/core/extensions/loader.js",
  import.meta.dir,
);
const agentDir = resolve(import.meta.dir, "../../..");

// Pi loads extensions through jiti on Node, where Bun-only APIs such as
// `import.meta.dir` are undefined. A Bun-only test run cannot catch that.
test.skipIf(!node)(
  "loads and hard-blocks through Pi's Node extension loader",
  () => {
    const script = `
    const { loadExtensions } = await import(${JSON.stringify(loader)});
    const dir = ${JSON.stringify(agentDir)};
    const result = await loadExtensions([dir + "/extensions/tool-call-guard/index.ts"], dir);
    const [handler] = result.extensions[0]?.handlers.get("tool_call") ?? [];
    const ctx = { cwd: dir, hasUI: false, signal: new AbortController().signal, ui: {} };
    const call = (command) =>
      handler?.({ type: "tool_call", toolName: "bash", toolCallId: "t", input: { command } }, ctx);
    console.log(JSON.stringify({
      errors: result.errors.length,
      status: (await call("git status")) ?? null,
      hardBlock: await call("mkfs.ext4 /dev/sda1"),
    }));
  `;
    const run = Bun.spawnSync([node ?? "node", "--input-type=module", "-e", script]);
    expect(run.exitCode).toBe(0);
    const output = JSON.parse(run.stdout.toString().trim().split("\n").at(-1) ?? "{}");
    expect(output).toEqual({
      errors: 0,
      status: null,
      hardBlock: { block: true, reason: "Blocked filesystem formatter command on block device." },
    });
  },
  30_000,
);
