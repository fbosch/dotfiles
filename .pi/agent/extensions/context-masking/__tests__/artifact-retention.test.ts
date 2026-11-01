import { afterEach, expect, test } from "bun:test";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  statSync, symlinkSync, utimesSync, writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ArtifactRetention, registerArtifactRetention } from "../artifact-retention";
import { DEFAULT_SETTINGS, parseSettings } from "../policy";

const DAY = 86_400_000;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "artifact-retention-"));
  roots.push(root);
  let now = 1_000 * DAY;
  const retention = () => new ArtifactRetention(root, () => now);
  const artifact = (session: string, name = "result.txt") => {
    const directory = join(root, session);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, name);
    writeFileSync(path, "saved evidence");
    return path;
  };
  const scan = (settings = DEFAULT_SETTINGS) => {
    const owner = retention();
    owner.start("scanner", settings);
    owner.stop();
  };
  const metadata = () => JSON.parse(readFileSync(join(root, ".retention.json"), "utf8"));
  return { root, retention, artifact, scan, metadata, now: () => now, advance: (days: number) => { now += days * DAY; } };
}

test("deletes whole inactive session caches exactly at the retention boundary", () => {
  const f = fixture();
  const text = f.artifact("old");
  const image = f.artifact("old", "image.png");
  f.scan();
  f.advance(29);
  f.scan();
  expect(readFileSync(text, "utf8")).toBe("saved evidence");
  f.advance(1);
  f.scan();
  expect(existsSync(join(f.root, "old"))).toBe(false);
  expect(existsSync(image)).toBe(false);
  expect(f.metadata().sessions.old).toBeUndefined();
});

test("gives pre-existing caches a full retention window instead of using artifact mtime", () => {
  const f = fixture();
  const path = f.artifact("legacy");
  utimesSync(path, 0, 0);
  utimesSync(join(f.root, "legacy"), 0, 0);
  f.scan();
  expect(readFileSync(path, "utf8")).toBe("saved evidence");
  f.advance(30);
  f.scan();
  expect(existsSync(path)).toBe(false);
});

test("resuming and closing a session reset inactivity without rewriting its artifacts", () => {
  const f = fixture();
  const path = f.artifact("old");
  const modified = statSync(path).mtimeMs;
  f.scan();
  f.advance(29);
  const resumed = f.retention();
  resumed.start("old", DEFAULT_SETTINGS);
  f.advance(29);
  resumed.touch();
  resumed.stop();
  f.advance(29);
  f.scan();
  expect(statSync(path).mtimeMs).toBe(modified);
  f.advance(1);
  f.scan();
  expect(existsSync(path)).toBe(false);
});

test("protects all live owners, including multiple owners of the same session", () => {
  const f = fixture();
  const path = f.artifact("active");
  const first = f.retention();
  const second = f.retention();
  first.start("active", DEFAULT_SETTINGS);
  second.start("active", DEFAULT_SETTINGS);
  first.stop();
  f.advance(365);
  f.scan();
  expect(readFileSync(path, "utf8")).toBe("saved evidence");
  second.stop();
  f.advance(30);
  f.scan();
  expect(existsSync(path)).toBe(false);
});

test("disabled expiry and retained session IDs preserve inactive evidence", () => {
  const f = fixture();
  const path = f.artifact("session_1");
  f.scan();
  f.advance(365);
  f.scan({ ...DEFAULT_SETTINGS, retentionDays: 0 });
  f.scan({ ...DEFAULT_SETTINGS, retainedSessionIds: ["session/1"] });
  expect(readFileSync(path, "utf8")).toBe("saved evidence");
  f.scan();
  expect(existsSync(path)).toBe(false);
});

test("reaps dead owners but preserves owners from another host", () => {
  const f = fixture();
  const dead = f.artifact("dead");
  const remote = f.artifact("remote");
  f.scan();
  const state = f.metadata();
  state.sessions.dead.owners.dead = { pid: 2_147_483_647, host: hostname() };
  state.sessions.remote.owners.remote = { pid: 2_147_483_647, host: "another-host" };
  writeFileSync(join(f.root, ".retention.json"), JSON.stringify(state));
  f.advance(30);
  f.scan();
  expect(existsSync(dead)).toBe(false);
  expect(readFileSync(remote, "utf8")).toBe("saved evidence");
});

test("never follows symlinked session directories or nested artifact symlinks", () => {
  const f = fixture();
  const outside = mkdtempSync(join(tmpdir(), "artifact-outside-"));
  roots.push(outside);
  const target = join(outside, "keep.txt");
  writeFileSync(target, "outside evidence");
  f.artifact("expired");
  symlinkSync(outside, join(f.root, "linked"));
  symlinkSync(target, join(f.root, "expired", "link.txt"));
  f.scan();
  f.advance(30);
  f.scan();
  expect(lstatSync(join(f.root, "linked")).isSymbolicLink()).toBe(true);
  expect(readFileSync(target, "utf8")).toBe("outside evidence");
  expect(existsSync(join(f.root, "expired"))).toBe(false);
});

test("invalid metadata prevents deletion, and metadata uses private permissions", () => {
  const f = fixture();
  const path = f.artifact("old");
  f.scan();
  expect(statSync(join(f.root, ".retention.json")).mode & 0o777).toBe(0o600);
  writeFileSync(join(f.root, ".retention.json"), '{"version":99}');
  f.advance(365);
  expect(() => f.scan()).toThrow("Invalid cache retention metadata");
  expect(readFileSync(path, "utf8")).toBe("saved evidence");
});

test("rejects symlinked cache roots and retention metadata", () => {
  const f = fixture();
  const linkedRoot = join(f.root, "linked-root");
  const target = join(f.root, "target");
  mkdirSync(target);
  symlinkSync(target, linkedRoot);
  expect(() => new ArtifactRetention(linkedRoot).start("s", DEFAULT_SETTINGS)).toThrow("Invalid cache root");
  const metadata = join(f.root, ".retention.json");
  writeFileSync(join(f.root, "other.json"), '{"version":1,"sessions":{}}');
  symlinkSync(join(f.root, "other.json"), metadata);
  expect(() => f.scan()).toThrow("Invalid cache retention file");
});

test("retention settings validate lifetime and explicitly retained IDs", () => {
  expect(DEFAULT_SETTINGS.retentionDays).toBe(30);
  expect(DEFAULT_SETTINGS.retainedSessionIds).toEqual([]);
  expect(parseSettings({ contextMasking: { retentionDays: 0, retainedSessionIds: ["session"] } }))
    .toMatchObject({ retentionDays: 0, retainedSessionIds: ["session"] });
  for (const contextMasking of [
    { retentionDays: -1 }, { retentionDays: 0.5 }, { retentionDays: Infinity },
    { retentionDays: 36501 }, { retainedSessionIds: [""] }, { retainedSessionIds: [1] },
  ]) expect(() => parseSettings({ contextMasking })).toThrow();
});

test("registers activity and release hooks even when masking is disabled", async () => {
  const f = fixture();
  type Handler = (event: never, ctx: ExtensionContext) => unknown;
  const handlers = new Map<string, Handler>();
  const pi = {
    on: (name: string, handler: Handler) => { handlers.set(name, handler); },
  } as unknown as Pick<ExtensionAPI, "on">;
  registerArtifactRetention(pi, { artifactRoot: () => f.root, settings: () => DEFAULT_SETTINGS, now: f.now });
  const ctx = { sessionManager: { getSessionId: () => "live" } } as unknown as ExtensionContext;
  const emit = async (name: string) => {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`Missing ${name} handler`);
    await handler({} as never, ctx);
  };
  await emit("session_start");
  const path = f.artifact("live");
  for (const event of ["before_agent_start", "agent_end", "session_tree"]) {
    f.advance(10);
    await emit(event);
  }
  f.advance(100);
  f.scan();
  expect(readFileSync(path, "utf8")).toBe("saved evidence");
  await emit("session_shutdown");
  f.advance(29);
  f.scan();
  expect(existsSync(path)).toBe(true);
  f.advance(1);
  f.scan();
  expect(existsSync(path)).toBe(false);
});

test("concurrent processes initialize metadata and protect their live sessions", async () => {
  const f = fixture();
  const module = new URL("../artifact-retention.ts", import.meta.url).pathname;
  const files = Array.from({ length: 4 }, (_, i) => f.artifact(`worker-${i}`));
  const children = files.map((_file, i) => Bun.spawn({
    cmd: [process.execPath, "-e", `
      import { ArtifactRetention } from ${JSON.stringify(module)};
      const retention = new ArtifactRetention(${JSON.stringify(f.root)}, () => ${f.now()});
      retention.start("worker-${i}", { retentionDays: 30, retainedSessionIds: [] });
      console.log("ready");
      process.stdin.resume();
    `],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  }));
  try {
    await Promise.all(children.map(async (child) => {
      const reader = child.stdout.getReader();
      try {
        const result = await reader.read();
        expect(new TextDecoder().decode(result.value)).toContain("ready");
      } finally {
        reader.releaseLock();
      }
    }));
    f.advance(365);
    f.scan();
    for (const file of files) expect(readFileSync(file, "utf8")).toBe("saved evidence");
  } finally {
    for (const child of children) child.kill();
    await Promise.all(children.map((child) => child.exited));
  }
  f.scan();
  for (const file of files) expect(existsSync(file)).toBe(false);
});

test("treats reserved object-property names as ordinary session IDs", () => {
  const f = fixture();
  const path = f.artifact("__proto__");
  const owner = f.retention();
  owner.start("__proto__", DEFAULT_SETTINGS);
  owner.stop();
  f.advance(30);
  f.scan();
  expect(existsSync(path)).toBe(false);
});

test("finishes interrupted deletion without treating other hidden directories as expired", () => {
  const f = fixture();
  const abandoned = f.artifact(".expired-00000000-0000-0000-0000-000000000000");
  const unrelated = f.artifact(".expired-unrecognized");
  f.scan();
  expect(existsSync(abandoned)).toBe(false);
  expect(readFileSync(unrelated, "utf8")).toBe("saved evidence");
});
