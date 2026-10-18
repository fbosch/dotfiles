import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { isMatching, P } from "ts-pattern";
import { withToolExecution } from "../../__tests__/fixtures/tool-context";
import dekitExtension from "../index";

// Idle import does not require a PTY or permission to execute recipe processes.
const nativeTest = process.env.PI_DEKIT_IMPORT_LIVE === "1" ? test : test.skip;
const tuiTest = process.env.PI_DEKIT_TUI_LIVE === "1" ? test : test.skip;
const processTest = process.env.PI_DEKIT_LIVE === "1" ? test : test.skip;

async function fixture(configured = false) {
  const binary = Bun.which(process.env.PI_DEKIT_BINARY ?? "dekit");
  if (binary === null) throw new Error("dekit binary not found");
  const directory = await realpath(await mkdtemp(join(tmpdir(), "dekit-native-import-")));
  const project = join(directory, "project");
  const home = join(directory, "home");
  await mkdir(project);
  await mkdir(home);
  await writeFile(join(project, "Justfile"), "hello:\n  @printf forbidden > executed\n");
  await writeFile(
    join(project, "package.json"),
    JSON.stringify({
      packageManager: "bun@1.4.0",
      scripts: {
        dev: `bun -e 'const f = require("node:fs"); const p = "runs"; f.writeFileSync(p, String(f.existsSync(p) ? Number(f.readFileSync(p, "utf8")) + 1 : 1)); console.log("native-service"); setInterval(() => {}, 1000)'`,
      },
    }),
  );
  if (configured)
    await writeFile(
      join(project, "dekit.yaml"),
      JSON.stringify({
        tasks: { manual: { cmd: ["unused-configured-command"], label: "Existing task" } },
      }),
    );
  const env = {
    ...process.env,
    HOME: home,
    TERM: "xterm-256color",
    PATH: `${dirname(binary)}:${process.env.PATH ?? ""}`,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_STATE_HOME: join(home, "state"),
    XDG_CACHE_HOME: join(home, "cache"),
    DEKIT_RUNNER_ROOT: undefined,
    DEKIT_RUNNER_KIND: undefined,
  };
  const executor: Pick<ExtensionAPI, "exec"> = {
    async exec(command, args, options) {
      const child = Bun.spawn([command === "dekit" ? binary : command, ...args], {
        env,
        cwd: options?.cwd ?? project,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 10_000,
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout, stderr, code, killed: child.signalCode !== null };
    },
  };
  async function run(args: string[]): Promise<unknown> {
    const result = await executor.exec("dekit", ["-C", project, "--json", ...args], {
      cwd: project,
    });
    if (result.code !== 0) throw new Error(result.stderr || result.stdout);
    try {
      return JSON.parse(result.stdout);
    } catch (cause) {
      throw new Error("Invalid native response", { cause });
    }
  }
  async function tasks() {
    const value = await run(["ls"]);
    if (
      !isMatching(
        { tasks: P.array({ id: P.number, path: P.string, label: P.string, state: P.string }) },
        value,
      )
    )
      throw new Error("Invalid native task list");
    return value.tasks;
  }
  async function importCatalog(): Promise<unknown> {
    const result = await executor.exec(
      process.execPath,
      [join(import.meta.dir, "..", "import-scripts.ts"), project],
      { cwd: project },
    );
    if (result.code !== 0) throw new Error(result.stderr || result.stdout);
    try {
      return JSON.parse(result.stdout);
    } catch (cause) {
      throw new Error("Invalid import response", { cause });
    }
  }
  async function close() {
    try {
      await run(["runner", "stop"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  return { binary, project, env, executor, run, tasks, importCatalog, close };
}

nativeTest(
  "real runner lists imported idle recipes without executing them or writing config",
  async () => {
    const h = await fixture();
    try {
      expect(await h.importCatalog()).toMatchObject({ project: h.project, imported: 2 });
      const before = await h.tasks();
      expect(before.map((task) => [task.label, task.state])).toEqual([
        ["just:hello", "idle"],
        ["package:dev", "idle"],
      ]);
      expect((await readdir(h.project)).sort()).toEqual(["Justfile", "package.json"]);
      await h.importCatalog();
      expect(await h.tasks()).toEqual(before);
      expect((await readdir(h.project)).sort()).toEqual(["Justfile", "package.json"]);
    } finally {
      await h.close();
    }
  },
  20_000,
);

nativeTest(
  "native import preserves existing project task definitions",
  async () => {
    const h = await fixture(true);
    try {
      const started = await h.executor.exec("dekit", [
        "-C",
        h.project,
        "--json",
        "runner",
        "start",
      ]);
      expect(started.code).toBe(0);
      const before = await h.tasks();
      expect(before).toHaveLength(1);
      const existing = before[0];
      if (existing === undefined) throw new Error("missing configured task");
      const config = await readFile(join(h.project, "dekit.yaml"), "utf8");
      await h.importCatalog();
      expect((await h.tasks()).find((task) => task.label === "Existing task")).toEqual(existing);
      expect(await readFile(join(h.project, "dekit.yaml"), "utf8")).toBe(config);
    } finally {
      await h.close();
    }
  },
  20_000,
);

tuiTest(
  "native console renders imported tasks and detaching preserves them",
  async () => {
    const h = await fixture();
    try {
      await h.importCatalog();
      const before = await h.tasks();
      let screen = "";
      let rendered: () => void = () => {};
      const visible = new Promise<void>((resolve) => {
        rendered = resolve;
      });
      const client = Bun.spawn([h.binary, "-C", h.project, "attach", "--no-start"], {
        cwd: h.project,
        env: h.env,
        terminal: {
          cols: 100,
          rows: 30,
          data(_terminal, data) {
            screen += Buffer.from(data).toString();
            if (
              screen.includes("Tasks") &&
              (screen.includes("just/") || screen.includes("just:hello"))
            )
              rendered();
          },
        },
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          visible,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(`Native console did not render imported tasks: ${screen.slice(-1200)}`),
                ),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
        client.kill();
        await client.exited;
        client.terminal?.close();
      }
      expect(await h.tasks()).toEqual(before);
    } finally {
      await h.close();
    }
  },
  20_000,
);

processTest(
  "Pi starts an imported task and native restart reuses its identity",
  async () => {
    const h = await fixture();
    try {
      await h.importCatalog();
      const initial = (await h.tasks()).find((task) => task.label === "package:dev");
      if (initial === undefined) throw new Error("missing imported service");
      const { path: taskPath, id: taskId } = initial;
      let tool: ToolDefinition | undefined;
      dekitExtension({
        ...h.executor,
        on() {},
        registerTool(value: ToolDefinition) {
          tool = value;
        },
      } as unknown as ExtensionAPI);
      if (tool === undefined) throw new Error("missing Pi tool");
      const context = withToolExecution({
        cwd: h.project,
        hasUI: false,
        isProjectTrusted: () => true,
      } as unknown as ExtensionContext);
      const started = await tool.execute(
        "start",
        { action: "start", script: "package:dev" },
        undefined,
        undefined,
        context,
      );
      expect(started.details).toMatchObject({ task: taskPath, accepted: true });
      async function waitForRun(number: string) {
        // Native CLI exposes snapshots; bound this integration-test wait.
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const file = Bun.file(join(h.project, "runs"));
          if ((await file.exists()) && (await file.text()) === number) return;
          const current = (await h.tasks()).find((task) => task.path === taskPath);
          if (current?.state === "exited")
            throw new Error(JSON.stringify(await h.run(["screen", taskPath])));
          await Bun.sleep(25);
        }
        throw new Error(`Service did not reach run ${number}`);
      }
      await waitForRun("1");
      await h.run(["restart", taskPath]);
      await waitForRun("2");
      expect((await h.tasks()).find((task) => task.path === taskPath)?.id).toBe(taskId);
    } finally {
      await h.close();
    }
  },
  25_000,
);
