import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { AgentMentionCache, type AgentMentionCacheFileSystem } from "../agent-mentions";

function createFakeFileSystem(caseInsensitive = false) {
  const directories = new Set<string>();
  const entries = new Map<string, Map<string, string>>();
  const watchers = new Map<string, Set<() => void>>();
  const calls = { reads: 0, closed: 0 };

  const addDirectory = (path: string) => {
    directories.add(path);
    entries.set(path, entries.get(path) ?? new Map());
    const parent = dirname(path);
    if (parent !== path && directories.has(parent)) entries.get(parent)?.set(basename(path), "");
  };
  const writeFile = (path: string, contents: string) => {
    entries.get(dirname(path))?.set(basename(path), contents);
  };
  const fileSystem: AgentMentionCacheFileSystem = {
    async readDirectory(path) {
      calls.reads++;
      const directory = entries.get(path);
      if (directory === undefined) throw new Error("missing directory");
      return [...directory.keys()];
    },
    async readText(path) {
      calls.reads++;
      const contents = entries.get(dirname(path))?.get(basename(path));
      if (contents === undefined) throw new Error("missing file");
      return contents;
    },
    async isDirectory(path) {
      return directories.has(path);
    },
    async pathIdentity(path) {
      calls.reads++;
      const candidate = [...(entries.get(dirname(path))?.keys() ?? [])].find((name) =>
        caseInsensitive
          ? name.toLowerCase() === basename(path).toLowerCase()
          : name === basename(path),
      );
      return candidate === undefined ? undefined : join(dirname(path), candidate);
    },
    async pathIsFile(path) {
      return entries.get(dirname(path))?.has(basename(path)) ?? false;
    },
    watchDirectory(path, onChange) {
      const listeners = watchers.get(path) ?? new Set();
      listeners.add(onChange);
      watchers.set(path, listeners);
      return () => {
        listeners.delete(onChange);
        calls.closed++;
      };
    },
  };

  return {
    fileSystem,
    calls,
    addDirectory,
    writeFile,
    removeFile(path: string) {
      entries.get(dirname(path))?.delete(basename(path));
    },
    emit(path: string) {
      for (const listener of watchers.get(path) ?? []) listener();
    },
    get watcherCount() {
      return [...watchers.values()].reduce((count, listeners) => count + listeners.size, 0);
    },
  };
}

function waitForChange(cache: AgentMentionCache): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = cache.subscribe(() => {
      unsubscribe();
      resolve();
    });
  });
}

test.each([false, true])(
  "path shadowing follows filesystem case sensitivity (%s)",
  async (caseInsensitive) => {
    const fs = createFakeFileSystem(caseInsensitive);
    fs.addDirectory("/project");
    fs.writeFile("/project/Explore", "file");
    const cache = new AgentMentionCache("/project", "/agent", false, fs.fileSystem);
    try {
      await cache.start();
      expect(cache.isPathShadowed("Explore")).toBe(true);
      expect(cache.isPathShadowed("explore")).toBe(caseInsensitive);
      const reads = fs.calls.reads;
      for (let frame = 0; frame < 20; frame++) {
        cache.getMentions();
        cache.isPathShadowed("Explore");
      }
      expect(fs.calls.reads).toBe(reads);
    } finally {
      cache.dispose();
    }
  },
);

test("refreshes reference file/image state on filesystem events without lookup I/O", async () => {
  const fs = createFakeFileSystem();
  fs.addDirectory("/project");
  fs.writeFile("/project/screenshot.png", "image");
  const cache = new AgentMentionCache("/project", "/agent", false, fs.fileSystem);
  try {
    await cache.start();
    cache.referencePathState("screenshot.png");
    await cache.refresh();
    expect(cache.referencePathState("screenshot.png")).toEqual({ exists: true, isFile: true });
    const reads = fs.calls.reads;
    for (let frame = 0; frame < 20; frame++) cache.referencePathState("screenshot.png");
    expect(fs.calls.reads).toBe(reads);
    const changed = waitForChange(cache);
    fs.removeFile("/project/screenshot.png");
    fs.emit("/project");
    await changed;
    expect(cache.referencePathState("screenshot.png")).toEqual({ exists: false, isFile: false });
  } finally {
    cache.dispose();
  }
});

test("disposal during asynchronous watcher discovery cannot install watchers afterwards", async () => {
  const fs = createFakeFileSystem();
  fs.addDirectory("/project");
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const isDirectory = fs.fileSystem.isDirectory;
  fs.fileSystem.isDirectory = async (path) => {
    await gate;
    return isDirectory(path);
  };
  const cache = new AgentMentionCache("/project", "/agent", false, fs.fileSystem);
  const startup = cache.start();
  cache.dispose();
  release();
  await startup;
  expect(fs.watcherCount).toBe(0);
});

test("re-arms native watches after atomically replacing the agent directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-mention-watch-"));
  const cwd = join(root, "project");
  const agentDirectory = join(root, "agent");
  const agents = join(agentDirectory, "agents");
  const replacement = join(agentDirectory, "replacement");
  await mkdir(cwd);
  await mkdir(agents, { recursive: true });
  await writeFile(join(agents, "review.md"), "---\ndescription: Old\n---\n");
  const cache = new AgentMentionCache(cwd, agentDirectory, false);
  try {
    await cache.start();
    await mkdir(replacement);
    await writeFile(join(replacement, "review.md"), "---\ndescription: New\n---\n");
    const replaced = waitForChange(cache);
    await rename(agents, join(agentDirectory, "old"));
    await rename(replacement, agents);
    await replaced;
    await cache.refresh();
    expect(cache.getMentions().find((mention) => mention.name === "review")?.description).toBe(
      "New",
    );
    const edited = waitForChange(cache);
    await writeFile(join(agents, "review.md"), "---\ndescription: Updated\n---\n");
    await edited;
    expect(cache.getMentions().find((mention) => mention.name === "review")?.description).toBe(
      "Updated",
    );
  } finally {
    cache.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

describe("agent mention cache", () => {
  const caches: AgentMentionCache[] = [];
  afterEach(() => {
    for (const cache of caches.splice(0)) cache.dispose();
  });

  test("watches missing directories, preserves overrides and path shadowing, and disposes", async () => {
    const fs = createFakeFileSystem();
    const root = "/virtual";
    const cwd = join(root, "project");
    const agentDirectory = join(root, "agent");
    const globalAgents = join(agentDirectory, "agents");
    const projectAgents = join(cwd, ".pi", "agents");
    fs.addDirectory(root);
    fs.addDirectory(cwd);
    fs.addDirectory(agentDirectory);
    fs.addDirectory(globalAgents);
    fs.writeFile(join(globalAgents, "review.md"), "---\ndescription: Global\n---\n");

    const cache = new AgentMentionCache(cwd, agentDirectory, true, fs.fileSystem);
    caches.push(cache);
    await cache.start();
    expect(cache.getMentions().find((mention) => mention.name === "review")?.description).toBe(
      "Global",
    );
    expect(fs.watcherCount).toBeGreaterThan(0);

    let changed = waitForChange(cache);
    fs.writeFile(join(cwd, "review"), "");
    fs.emit(cwd);
    await changed;
    expect(cache.isPathShadowed("review")).toBe(true);

    fs.addDirectory(join(cwd, ".pi"));
    fs.addDirectory(projectAgents);
    fs.writeFile(join(projectAgents, "review.md"), "---\nenabled: false\n---\n");
    changed = waitForChange(cache);
    fs.emit(cwd);
    await changed;
    expect(cache.getMentions().some((mention) => mention.name === "review")).toBe(false);

    changed = waitForChange(cache);
    fs.writeFile(join(projectAgents, "review.md"), "---\ndescription: Project\n---\n");
    fs.emit(projectAgents);
    await changed;
    expect(cache.getMentions().find((mention) => mention.name === "review")?.description).toBe(
      "Project",
    );

    changed = waitForChange(cache);
    fs.removeFile(join(projectAgents, "review.md"));
    fs.emit(projectAgents);
    await changed;
    expect(cache.getMentions().find((mention) => mention.name === "review")?.description).toBe(
      "Global",
    );

    const readsBeforeDispose = fs.calls.reads;
    cache.dispose();
    expect(fs.watcherCount).toBe(0);
    fs.emit(cwd);
    await Promise.resolve();
    expect(fs.calls.reads).toBe(readsBeforeDispose);
    expect(fs.calls.closed).toBeGreaterThan(0);
  });
});
