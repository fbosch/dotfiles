import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadExtensions } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

const agentRoot = resolve(import.meta.dir, "../..");
const extensionPath = resolve(agentRoot, "npm/node_modules/pi-hashline-edit-pro/index.ts");

describe("pi-hashline-edit-pro package loading", () => {
  test("resolves every transitive import with native export checks", async () => {
    // Jiti accepts missing named exports that can then fail only during rendering.
    const extension = await import(extensionPath);
    expect(typeof extension.default).toBe("function");
  });

  test("imports and registers the installed extension through Pi's loader", async () => {
    // Submodule-only tests miss broken transitive imports in the extension factory.
    const result = await loadExtensions([extensionPath], agentRoot);

    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
    const extension = result.extensions[0];
    if (!extension) throw new Error("Hashline extension failed to load");
    expect([...extension.tools.keys()].sort()).toEqual([
      "anchor_grep",
      "copy",
      "insert",
      "move",
      "read",
      "replace",
      "undo_last_change",
    ]);
  }, 20_000);
});
