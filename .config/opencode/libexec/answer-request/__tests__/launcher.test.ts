import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

describe("answer request launcher", () => {
  test("runs the CLI through Bun without dependency installation", async () => {
    const launcher = fileURLToPath(new URL("../../../scripts/answer-request.sh", import.meta.url));
    const source = await readFile(launcher, "utf8");
    assert.match(source, /bun --cwd .* --no-install answer-request\/cli\.ts/);
    assert.doesNotMatch(source, / run --no-install /);
    assert.match(source, /answer-request\/cli\.ts "\$@"/);
  });
});
