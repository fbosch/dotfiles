import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const agentRoot = resolve(import.meta.dir, "../../..");
const name = "@gotgenes/pi-permission-system";
const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-permission-imports-")));
const packageDir = join(root, "node_modules", name);
const manifest = join(packageDir, "package.json");
const sourceFiles = new Map<string, string>();
let originalInventory: unknown;

function inventory() {
  const loader = join(
    agentRoot,
    "node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js",
  );
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
        const { loadExtensions } = await import(${JSON.stringify(loader)});
        const { extensions, errors } = await loadExtensions(
          [${JSON.stringify(join(packageDir, "src/index.ts"))}], process.cwd(),
        );
        if (errors.length) throw new Error(JSON.stringify(errors));
        const extension = extensions[0];
        if (!extension) throw new Error("Permission extension did not load");
        const service = await import(${JSON.stringify(join(packageDir, "src/service.ts"))});
        console.log(JSON.stringify({
          handlers: [...extension.handlers].map(([name, handlers]) => [name, handlers.length]).sort(),
          commands: [...extension.commands.keys()].sort(),
          exports: Object.keys(service).sort(),
        }));
      `,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        HOME: root,
        PI_CODING_AGENT_DIR: join(root, "agent"),
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    },
  );
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout.toString());
}

function applyImportPatch() {
  const result = Bun.spawnSync(
    [
      process.execPath,
      join(agentRoot, "node_modules/patch-package/index.js"),
      "--patch-dir",
      "patches",
      "--error-on-fail",
      "--error-on-warn",
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
}

beforeAll(() => {
  cpSync(join(agentRoot, "npm/node_modules", name), packageDir, {
    recursive: true,
  });
  const pristineManifest = readFileSync(manifest, "utf8").replace(
    '"#src/*": "./src/*.ts"',
    '"#src/*": "./src/*"',
  );
  expect(createHash("sha256").update(pristineManifest).digest("hex")).toBe(
    "954159629069327f52724d01125e4d8ecf4cd742a7bc516cbc38923fa2a613f7",
  );
  writeFileSync(manifest, pristineManifest);
  writeFileSync(join(root, "package.json"), '{"private":true}\n');
  mkdirSync(join(root, "agent"));
  symlinkSync(join(agentRoot, "npm/node_modules"), join(packageDir, "node_modules"));
  for (const file of readdirSync(join(packageDir, "src"), {
    recursive: true,
    encoding: "utf8",
  })) {
    if (file.endsWith(".ts")) {
      const path = join(packageDir, "src", file);
      sourceFiles.set(path, readFileSync(path, "utf8"));
    }
  }
  const patch = readFileSync(
    join(agentRoot, "patches/@gotgenes+pi-permission-system+31.1.1.patch"),
    "utf8",
  )
    .split(/(?=^diff --git )/m)
    .find((section) => section.startsWith(`diff --git a/node_modules/${name}/package.json `));
  if (!patch) throw new Error("Missing permission-system import-map patch");
  mkdirSync(join(root, "patches"));
  // Exercise the import hunk independently of the existing infrastructure-read patch.
  writeFileSync(join(root, "patches/@gotgenes+pi-permission-system+31.1.1.patch"), patch);
  originalInventory = inventory();
  applyImportPatch();
}, 30_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

test("all runtime aliases resolve directly to the same TypeScript source files", () => {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const aliases = new Set<string>();
  for (const contents of sourceFiles.values()) {
    for (const { path } of transpiler.scanImports(contents)) {
      if (path.startsWith("#src/")) aliases.add(path);
    }
  }
  expect(aliases.size).toBeGreaterThan(0);
  const expected = [...aliases].sort().map((alias) => {
    const path = join(packageDir, "src", `${alias.slice("#src/".length)}.ts`);
    expect(sourceFiles.has(path)).toBe(true);
    return path;
  });
  // Use Node's resolver, not Bun's implicit TypeScript extension fallback.
  const result = Bun.spawnSync(
    [
      "node",
      "--input-type=module",
      "--eval",
      `import { createRequire } from "node:module";
       const require = createRequire(${JSON.stringify(manifest)});
       console.log(JSON.stringify(${JSON.stringify([...aliases].sort())}.map(alias => require.resolve(alias))));`,
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toEqual(expected);
  for (const [path, contents] of sourceFiles) expect(readFileSync(path, "utf8")).toBe(contents);
});

test("registers permission gates and commands before session start with unchanged service exports", () => {
  const patchedInventory = inventory();
  expect(patchedInventory).toEqual(originalInventory);
  expect(patchedInventory).toMatchObject({
    handlers: [
      ["before_agent_start", 1],
      ["input", 1],
      ["resources_discover", 1],
      ["session_shutdown", 1],
      ["session_start", 1],
      ["tool_call", 1],
    ],
    commands: ["permission-system"],
    exports: expect.arrayContaining(["getPermissionsService", "PERMISSIONS_READY_CHANNEL"]),
  });
});

test("reapplies the tracked import patch without changing package metadata", () => {
  const first = readFileSync(manifest, "utf8");
  applyImportPatch();
  expect(readFileSync(manifest, "utf8")).toBe(first);
  expect(JSON.parse(first)).toMatchObject({
    name,
    version: "31.1.1",
    imports: { "#src/*": "./src/*.ts", "#test/*": "./test/*" },
  });
});
