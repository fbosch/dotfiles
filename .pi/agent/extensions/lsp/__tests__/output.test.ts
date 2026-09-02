import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderLocations } from "../output";
import { canonicalProjectRoot } from "../paths";

test("bounds location candidates before filesystem rendering", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-lsp-output-"));
  const path = join(directory, "example.ts");
  await writeFile(path, "value\n");
  try {
    const location = {
      range: {
        end: { character: 1, line: 0 },
        start: { character: 0, line: 0 },
      },
      uri: pathToFileURL(path).href,
    };
    const root = await canonicalProjectRoot(directory);
    const output = await renderLocations(root, [
      { locations: Array.from({ length: 201 }, () => location), serverId: "fake" },
    ]);
    expect(output).toContain("example.ts:1:1-1:2 (fake)");
    expect(output).toContain("[truncated: 1 location candidates omitted]");
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
