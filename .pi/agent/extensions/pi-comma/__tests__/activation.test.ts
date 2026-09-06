import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const paths: string[] = [];
const entry = join(import.meta.dir, "..", "index.ts");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-comma-activation-"));
  paths.push(root);
  return root;
}

async function load(entryPath: string, path: string, platform?: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `import extension from ${JSON.stringify(entryPath)};
     ${platform === undefined ? "" : `Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });`}
     let registrations = 0;
     await extension({
       on() { registrations++; },
       getAllTools() { throw new Error("factory action method"); }
     });
     process.stdout.write(JSON.stringify({ registrations }));`,
    ],
    {
      cwd: path.split(":")[0] ?? tmpdir(),
      env: { ...process.env, PATH: path },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  return stdout;
}

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

for (const failure of ["absent", "denied", "broken", "timeout"] as const) {
  test(`factory stays silent with no registrations when comma is ${failure}`, async () => {
    const root = await fixture();
    const comma = join(root, "comma");
    if (failure !== "absent") {
      await writeFile(
        comma,
        failure === "timeout"
          ? "#!/bin/sh\ntrap '' TERM\nwhile :; do :; done\n"
          : "#!/bin/sh\nprintf unexpected-stdout; printf unexpected-stderr >&2; exit 1\n",
      );
      await chmod(comma, failure === "denied" ? 0o644 : 0o755);
    }
    const started = Date.now();
    expect(await load(entry, root)).toBe('{"registrations":0}');
    expect(Date.now() - started).toBeLessThan(3_000);
  });
}

test("missing optional direnv sibling and unsupported platforms are silent", async () => {
  const root = await fixture();
  const copiedEntry = join(root, "index.ts");
  await writeFile(copiedEntry, await readFile(entry, "utf8"));
  expect(await load(copiedEntry, root)).toBe('{"registrations":0}');
  await writeFile(join(root, "comma"), "#!/bin/sh\nprintf should-not-run >&2\nexit 0\n");
  await chmod(join(root, "comma"), 0o755);
  expect(await load(copiedEntry, root, "win32")).toBe('{"registrations":0}');
});

test("PATH lookup skips directories named comma", async () => {
  const first = await fixture();
  const second = await fixture();
  await mkdir(join(first, "comma"));
  await writeFile(join(second, "comma"), "#!/bin/sh\nexit 0\n");
  await chmod(join(second, "comma"), 0o755);
  expect(await load(entry, `${first}:${second}`)).toBe('{"registrations":1}');
});
