import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("../startup-manifest.sh", import.meta.url));

async function partition(entries: string[]) {
  const directory = await mkdtemp(join(tmpdir(), "pi-startup-manifest-"));
  try {
    const source = join(directory, "all.tsv");
    const immutable = join(directory, "immutable.tsv");
    const runtime = join(directory, "runtime.tsv");
    await writeFile(source, `${entries.join("\n")}\n`);
    const child = Bun.spawn(
      [
        "bash",
        "-euc",
        'source "$1"; split_fixture_manifest "$2" "$3" "$4"',
        "manifest-test",
        helper,
        source,
        immutable,
        runtime,
      ],
      { stderr: "pipe", stdout: "pipe" },
    );
    const stderr = await new Response(child.stderr).text();
    expect(await child.exited).toBe(0);
    expect(stderr).toBe("");
    return {
      immutable: await readFile(immutable, "utf8"),
      runtime: await readFile(runtime, "utf8"),
    };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test("records known runtime writes without changing the immutable input manifest", async () => {
  const source = "agent/extensions/example/index.ts\tfile:source";
  const outputs = [
    `agent/cache/pi-worktrunk/${"a".repeat(64)}.json`,
    "agent/fff/frecency/data.mdb",
    "agent/fff/frecency/lock.mdb",
    "agent/fff/history/data.mdb",
    "agent/fff/history/lock.mdb",
    "agent/sessions/permission-forwarding/serving/session.json",
    "tmp/jiti/example.1234abcd.mjs",
    "tmp/jiti/example.1234abcd.cjs",
  ];
  const before = await partition([source, ...outputs.map((path) => `${path}\tfile:before`)]);
  const after = await partition([source, ...outputs.map((path) => `${path}\tfile:after`)]);
  expect(before.immutable).toBe(`${source}\n`);
  expect(after.immutable).toBe(before.immutable);
  expect(after.runtime).not.toBe(before.runtime);
  expect(after.runtime.trim().split("\n")).toHaveLength(outputs.length);
});

test("preserves unexpected paths and symlinks as strict immutable inputs", async () => {
  const entries = [
    "agent/extensions/example/index.ts\tfile:changed",
    "agent/settings.json\tfile:changed",
    "agent/auth.json\tfile:unexpected",
    `agent/cache/pi-worktrunk/${"a".repeat(64)}.json\tlink:/outside`,
    "agent/cache/pi-worktrunk/short.json\tfile:unexpected",
    `agent/cache/pi-worktrunk/${"a".repeat(63)}.json\tfile:unexpected`,
    `agent/cache/pi-worktrunk/${"a".repeat(64)}.tmp\tfile:unexpected`,
    `agent/cache/pi-worktrunk/nested/${"a".repeat(64)}.json\tfile:unexpected`,
    "agent/fff/frecency/config.json\tfile:unexpected",
    "agent/fff/other/data.mdb\tfile:unexpected",
    "agent/fff/frecency/data.mdb\tlink:/outside",
    "tmp/jiti/example.1234abcd.mjs\tlink:/outside",
    "tmp/jiti/nested/example.1234abcd.mjs\tfile:unexpected",
    "tmp/jiti/example.not-a-hash.mjs\tfile:unexpected",
    "tmp/other.ts\tfile:unexpected",
    "agent/sessions/permission-forwarding/serving/nested/session.json\tfile:unexpected",
  ];
  const result = await partition(entries);
  expect(result.immutable).toBe(`${entries.join("\n")}\n`);
  expect(result.runtime).toBe("");
});
