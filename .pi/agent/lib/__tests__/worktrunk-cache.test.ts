import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { applyPiPatches } from "../pi-npm";

type Identity = { path: string; realpath: string; ino: string; mtimeNs: string; ctimeNs: string };
type Value = {
  version: string;
  commands: { name: string; description: string }[];
  reference: string;
};
type Discovery = { value: Value; complete: boolean };
type Cache = {
  GENERATOR_REVISION: string;
  executableIdentity(command: string, cwd: string): Identity | undefined;
  readReferenceCache(directory: string, identity: Identity): Value | undefined;
  writeReferenceCache(directory: string, identity: Identity, value: Value): void;
  cachedReference(
    directory: string,
    cwd: string,
    signal: AbortSignal | undefined,
    discover: () => Promise<Discovery | undefined>,
  ): Promise<Value | undefined>;
};
type WtResult = { code: number; stdout: string; stderr: string; killed?: boolean };
const sourceRoot = resolve(import.meta.dir, "../..");
const pristineHash = "b6773d882a3333c450ff6ee825a023b475dc3cd4542cd3aacf46db335045837d";
const patch = join(sourceRoot, "patches/pi-worktrunk+0.8.0.patch");
const packageFixture = mkdtempSync(join(tmpdir(), "pi-worktrunk-package-"));
let cache: Cache;
let extension: (pi: ExtensionAPI) => void;
let directory: string;
let cacheDir: string;
let wt: string;
const originalPath = process.env.PATH;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const value: Value = {
  version: "wt 0.74.0",
  commands: [{ name: "list", description: "List worktrees" }],
  reference: "Worktrunk command reference\nlist",
};
const discovery = async (): Promise<Discovery> => ({ value, complete: true });

beforeAll(async () => {
  const packageDir = join(packageFixture, "node_modules/pi-worktrunk");
  cpSync(join(sourceRoot, "npm/node_modules/pi-worktrunk"), packageDir, { recursive: true });
  const reverse = Bun.spawnSync(["git", "apply", "--reverse", "--check", patch], {
    cwd: packageFixture,
  });
  if (reverse.exitCode === 0) {
    expect(
      Bun.spawnSync(["git", "apply", "--reverse", patch], { cwd: packageFixture }).exitCode,
    ).toBe(0);
  }
  expect(
    createHash("sha256")
      .update(readFileSync(join(packageDir, "worktrunk.ts")))
      .digest("hex"),
  ).toBe(pristineHash);
  writeFileSync(
    join(packageFixture, "package.json"),
    '{"name":"worktrunk-fixture","private":true}',
  );
  expect(applyPiPatches(packageFixture)).toBe(0);
  symlinkSync(join(sourceRoot, "node_modules"), join(packageDir, "node_modules"));
  cache = await import(join(packageDir, "reference-cache.ts"));
  ({ default: extension } = await import(join(packageDir, "worktrunk.ts")));
});
afterAll(() => rmSync(packageFixture, { recursive: true, force: true }));

function nativeFile(path: string, content = "first") {
  writeFileSync(
    path,
    Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from(content)]),
    { mode: 0o755 },
  );
}
function identity() {
  const result = cache.executableIdentity("wt", directory);
  if (!result) throw new Error("Fixture executable was not identified");
  return result;
}
function load(discover = discovery, signal?: AbortSignal) {
  return cache.cachedReference(cacheDir, directory, signal, discover);
}
function cacheFile() {
  const files = readdirSync(cacheDir);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
  return join(cacheDir, files[0] ?? "missing");
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pi-worktrunk-cache-"));
  cacheDir = join(directory, "agent/cache/pi-worktrunk");
  mkdirSync(join(directory, "bin"));
  wt = join(directory, "bin/wt");
  nativeFile(wt);
  process.env.PATH = `${join(directory, "bin")}:${originalPath ?? ""}`;
  process.env.PI_CODING_AGENT_DIR = join(directory, "agent");
});
afterEach(() => {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(directory, { recursive: true, force: true });
});

describe("executable-keyed reference cache", () => {
  test("hits without discovery and uses private atomic files", async () => {
    expect(await load()).toEqual(value);
    expect(
      await load(async () => {
        throw new Error("cache missed");
      }),
    ).toEqual(value);
    expect(statSync(cacheFile()).mode & 0o777).toBe(0o600);
    expect(statSync(cacheDir).mode & 0o777).toBe(0o700);
  });

  test("resolves relative and empty PATH entries against command cwd", () => {
    process.env.PATH = "bin";
    expect(identity().path).toBe(wt);
    nativeFile(join(directory, "wt"));
    process.env.PATH = "";
    expect(identity().path).toBe(join(directory, "wt"));
    const other = join(directory, "other");
    mkdirSync(other);
    expect(cache.executableIdentity("wt", other)).toBeUndefined();
  });

  test("unset PATH uses Node's standard search rather than command cwd", () => {
    nativeFile(join(directory, "wt"));
    delete process.env.PATH;
    expect(cache.executableIdentity("wt", directory)?.path).not.toBe(join(directory, "wt"));
  });

  test("PATH selection changes invalidate the reference", async () => {
    await load();
    mkdirSync(join(directory, "other"));
    nativeFile(join(directory, "other/wt"));
    process.env.PATH = join(directory, "other");
    let called = false;
    await load(async () => {
      called = true;
      return discovery();
    });
    expect(called).toBe(true);
  });

  test("symlink upgrade and rollback select the matching cache only", async () => {
    const old = join(directory, "old-wt");
    const next = join(directory, "new-wt");
    renameSync(wt, old);
    nativeFile(next, "newer");
    symlinkSync(old, wt);
    await load();
    unlinkSync(wt);
    symlinkSync(next, wt);
    const newer = { ...value, reference: "new reference" };
    expect(await load(async () => ({ value: newer, complete: true }))).toEqual(newer);
    unlinkSync(wt);
    symlinkSync(old, wt);
    expect(
      await load(async () => {
        throw new Error("rollback should reuse old identity");
      }),
    ).toEqual(value);
  });

  test("same-version replacement at the same path invalidates even with preserved mtime", async () => {
    await load();
    const before = identity();
    const stat = statSync(wt);
    nativeFile(join(directory, "replacement"), "other");
    utimesSync(join(directory, "replacement"), stat.atime, stat.mtime);
    renameSync(join(directory, "replacement"), wt);
    expect(identity().ino).not.toBe(before.ino);
    let called = false;
    await load(async () => {
      called = true;
      return discovery();
    });
    expect(called).toBe(true);
  });

  test("in-place writes preserving size and mtime still change ctime", async () => {
    await load();
    const before = identity();
    const stat = statSync(wt);
    nativeFile(wt, "other");
    utimesSync(wt, stat.atime, stat.mtime);
    expect(identity().ctimeNs).not.toBe(before.ctimeNs);
    expect(cache.readReferenceCache(cacheDir, identity())).toBeUndefined();
  });

  test.each([
    "corrupt",
    "oversized",
    "revision",
    "identity",
    "empty-commands",
    "unsafe-name",
    "duplicate",
  ])("rejects %s cached data", async (kind) => {
    await load();
    const file = cacheFile();
    const entry = JSON.parse(readFileSync(file, "utf8"));
    if (kind === "corrupt") writeFileSync(file, "{broken");
    else if (kind === "oversized") writeFileSync(file, " ".repeat(256_001));
    else {
      if (kind === "revision") entry.revision = `${cache.GENERATOR_REVISION}-old`;
      if (kind === "identity") entry.identity.ino = "different";
      if (kind === "empty-commands") entry.value.commands = [];
      if (kind === "unsafe-name") entry.value.commands[0].name = "--help";
      if (kind === "duplicate") entry.value.commands.push(entry.value.commands[0]);
      writeFileSync(file, JSON.stringify(entry));
    }
    expect(cache.readReferenceCache(cacheDir, identity())).toBeUndefined();
    expect(await load()).toEqual(value);
  });

  test("does not replace a complete entry with partial discovery", async () => {
    await load();
    const before = readFileSync(cacheFile(), "utf8");
    expect(
      await load(async () => ({ value: { ...value, reference: "partial" }, complete: false })),
    ).toEqual(value);
    expect(readFileSync(cacheFile(), "utf8")).toBe(before);
    unlinkSync(cacheFile());
    expect(await load(async () => ({ value, complete: false }))).toEqual(value);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  test("discard generation if executable changes or disappears", async () => {
    expect(
      await load(async () => {
        nativeFile(wt, "changed");
        return discovery();
      }),
    ).toBeUndefined();
    expect(existsSync(cacheDir)).toBe(false);
    expect(
      await load(async () => {
        unlinkSync(wt);
        process.env.PATH = "bin";
        return discovery();
      }),
    ).toBeUndefined();
  });

  test("aborts do not read, generate, or persist stale results", async () => {
    await load();
    const aborted = new AbortController();
    aborted.abort();
    expect(
      await load(async () => {
        throw new Error("must not run");
      }, aborted.signal),
    ).toBeUndefined();
    unlinkSync(cacheFile());
    const pending = new AbortController();
    expect(
      await load(async () => {
        pending.abort();
        return discovery();
      }, pending.signal),
    ).toBeUndefined();
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  test("wrappers discover live on every call without persistent reuse", async () => {
    writeFileSync(wt, "#!/bin/sh\necho wt\n");
    let calls = 0;
    for (let i = 0; i < 2; i++) {
      expect(
        await load(async () => {
          calls++;
          return discovery();
        }),
      ).toEqual(value);
    }
    expect(calls).toBe(2);
    expect(existsSync(cacheDir)).toBe(false);
  });

  test("cache failures do not fail live discovery or leave temporary files", async () => {
    mkdirSync(cacheDir, { recursive: true });
    chmodSync(cacheDir, 0o777);
    expect(await load()).toEqual(value);
    expect(readdirSync(cacheDir)).toEqual([]);
    chmodSync(cacheDir, 0o700);
    await load();
    const target = cacheFile();
    unlinkSync(target);
    mkdirSync(target);
    expect(await load()).toEqual(value);
    expect(readdirSync(cacheDir)).toEqual([target.split("/").at(-1) ?? ""]);
  });

  test("does not follow a cache-file symlink", async () => {
    await load();
    const file = cacheFile();
    const external = join(directory, "external.json");
    copyFileSync(file, external);
    unlinkSync(file);
    symlinkSync(external, file);
    expect(cache.readReferenceCache(cacheDir, identity())).toBeUndefined();
  });

  test("parallel writers produce one valid complete entry", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        load(async () => {
          await new Promise<void>((resolve) => setImmediate(resolve));
          return discovery();
        }),
      ),
    );
    expect(results).toEqual(Array.from({ length: 8 }, () => value));
    expect(cache.readReferenceCache(cacheDir, identity())).toEqual(value);
    cacheFile();
  });
});

const rootHelp =
  "wt - Worktrunk\n\nUsage: wt [OPTIONS] <COMMAND>\n\nCommands:\n  list  List worktrees\n";
const listHelp =
  "wt list - List worktrees\n\nUsage: wt list [OPTIONS]\n\nOptions:\n  --full  Include status\n";
function mockSession(override?: (args: string[]) => Promise<WtResult | undefined>) {
  let start: ((event: unknown, ctx: ExtensionContext) => Promise<void>) | undefined;
  let tool: ToolDefinition | undefined;
  let alias = "first";
  const calls: string[][] = [];
  // Only registration and session_start run; all real process execution is replaced.
  const api = {
    on: (event: string, handler: typeof start) => {
      if (event === "session_start") start = handler;
    },
    registerTool: (definition: ToolDefinition) => {
      tool = definition;
    },
    registerCommand: () => {},
    registerMessageRenderer: () => {},
    exec: async (command: string, args: string[]) => {
      if (command === "git") return { code: 1, stdout: "", stderr: "" };
      calls.push(args);
      const custom = await override?.(args);
      if (custom) return custom;
      const stdout =
        args[0] === "--help-md"
          ? rootHelp
          : args.at(-1) === "--help-md"
            ? listHelp
            : args[0] === "--version"
              ? "wt 0.74.0"
              : args.join(" ") === "config show --format=json"
                ? JSON.stringify({ user: { config: { aliases: { [alias]: "echo ok" } } } })
                : "";
      return { code: 0, stdout, stderr: "" };
    },
  };
  extension(api as unknown as ExtensionAPI);
  return {
    calls,
    setAlias: (name: string) => {
      alias = name;
    },
    start: async (signal = new AbortController().signal) => {
      if (!start) throw new Error("Missing session_start");
      await start({}, {
        cwd: directory,
        signal,
        sessionManager: { getEntries: () => [] },
      } as unknown as ExtensionContext);
      if (!tool) throw new Error("Missing registered tool");
      return tool;
    },
  };
}

describe("patched extension discovery", () => {
  test("warm startup skips help/version but refreshes alias choices and preserves reference", async () => {
    const session = mockSession();
    const cold = await session.start();
    expect(session.calls.filter((args) => args.includes("--help-md"))).toHaveLength(2);
    expect(cold.description).toContain("--full");
    session.calls.length = 0;
    session.setAlias("second");
    const warm = await session.start();
    expect(
      session.calls.some((args) => args.includes("--help-md") || args.includes("--version")),
    ).toBe(false);
    expect(session.calls.some((args) => args.join(" ") === "config show --format=json")).toBe(true);
    expect(warm.description).toContain("--full");
    expect(warm.description).toContain("second");
    expect(warm.description).not.toContain("- first:");
    expect(JSON.stringify(warm.parameters)).toContain('"second"');
    expect(JSON.stringify(warm.parameters)).not.toContain('"first"');
  });

  test.each(["root", "subcommand", "killed", "malformed", "version"])(
    "never persists %s failures",
    async (failure) => {
      const session = mockSession(async (args) => {
        const root = args[0] === "--help-md";
        const sub = args[0] === "list" && args[1] === "--help-md";
        if (
          (failure === "root" && root) ||
          (failure === "subcommand" && sub) ||
          (failure === "version" && args[0] === "--version")
        )
          return { code: 1, stdout: "", stderr: "failed" };
        if (failure === "killed" && sub)
          return { code: 0, stdout: listHelp, stderr: "", killed: true };
        if (failure === "malformed" && sub)
          return { code: 0, stdout: "Usage: wt wrong-command", stderr: "" };
        return undefined;
      });
      const tool = await session.start();
      expect(existsSync(cacheDir)).toBe(false);
      expect(tool.description).toContain("first");
    },
  );
});
