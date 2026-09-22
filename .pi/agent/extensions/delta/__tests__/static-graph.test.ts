import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  type DeltaDetails,
  type DeltaExtensionDependencies,
  type DeltaResult,
  registerDeltaExtension,
} from "../index";

const details: DeltaDetails = {
  display: "inline",
  noChanges: false,
  output: "1 old    1 new",
  scope: "unstaged changes",
  width: 80,
};

const result: DeltaResult = { content: "1 old    1 new", details };

async function buildDeltaBundle(outdir: string) {
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "..", "index.ts")],
    format: "esm",
    metafile: true,
    outdir,
    splitting: true,
    target: "bun",
  });
  if (!build.success) {
    throw new Error(build.logs.map((log) => log.message).join("\n"));
  }
  return build;
}

test("keeps command, execution, and edit-preview dependencies out of the startup chunk", async () => {
  const outdir = await mkdtemp(join(tmpdir(), "pi-delta-bundle-"));
  try {
    await buildDeltaBundle(outdir);
    const entry = await readFile(join(outdir, "index.js"), "utf8");
    const files = await readdir(outdir);
    const chunks = await Promise.all(
      files
        .filter((file) => file.endsWith(".js"))
        .map(async (file) => [file, await readFile(join(outdir, file), "utf8")] as const),
    );

    expect(entry).not.toContain("child_process");
    expect(entry).not.toContain("createEditToolDefinition");
    expect(entry).not.toContain("BorderedLoader");
    expect(entry).toContain('import("./chunk-');

    expect(chunks.find(([, source]) => source.includes("child_process"))).toBeDefined();
    expect(chunks.find(([, source]) => source.includes("createEditToolDefinition"))).toBeDefined();
    expect(chunks.find(([, source]) => source.includes("BorderedLoader"))).toBeDefined();
  } finally {
    await rm(outdir, { force: true, recursive: true });
  }
});

describe("first-use module loaders", () => {
  function createPi() {
    let commandHandler:
      | ((args: string, context: ExtensionCommandContext) => Promise<void> | void)
      | undefined;
    let sessionStart:
      | ((event: unknown, context: ExtensionContext) => Promise<void> | void)
      | undefined;
    const registeredTools: ToolDefinition[] = [];
    const pi = {
      appendEntry: () => {},
      on(
        event: string,
        handler: (event: unknown, context: ExtensionContext) => Promise<void> | void,
      ) {
        if (event === "session_start") sessionStart = handler;
      },
      registerCommand(
        _name: string,
        command: {
          handler: (args: string, context: ExtensionCommandContext) => Promise<void> | void;
        },
      ) {
        commandHandler = command.handler;
      },
      registerEntryRenderer: () => {},
      registerTool(tool: ToolDefinition) {
        registeredTools.push(tool);
      },
      exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    } as unknown as ExtensionAPI;
    return {
      commandHandler: () => commandHandler,
      pi,
      registeredTools,
      sessionStart: () => sessionStart,
    };
  }

  test("loads the command module only when the command executes", async () => {
    const { commandHandler, pi } = createPi();
    let loads = 0;
    registerDeltaExtension(pi, {
      config: { editPreviews: false },
      loadCommand: async () => {
        loads += 1;
        return {
          runDeltaCommand: async (_context, _run, appendEntry) => appendEntry(details),
        };
      },
      run: async () => result,
    });

    expect(loads).toBe(0);
    const handler = commandHandler();
    if (handler === undefined) throw new Error("/delta command was not registered");
    await handler("", { cwd: "/repo", mode: "tui" } as ExtensionCommandContext);
    expect(loads).toBe(1);
  });

  test("loads edit-preview implementation only for enabled sessions", async () => {
    const disabled = createPi();
    let disabledLoads = 0;
    const disabledDependencies: DeltaExtensionDependencies = {
      config: { editPreviews: false },
      loadEditPreview: async () => {
        disabledLoads += 1;
        throw new Error("edit preview should remain unloaded");
      },
    };
    registerDeltaExtension(disabled.pi, disabledDependencies);
    await disabled.sessionStart()?.({}, { cwd: "/repo" } as ExtensionContext);
    expect(disabledLoads).toBe(0);

    const enabled = createPi();
    let enabledLoads = 0;
    const enabledDependencies: DeltaExtensionDependencies = {
      config: { editPreviews: true },
      loadEditPreview: async () => {
        enabledLoads += 1;
        const createDeltaEditTool = (() =>
          ({ name: "edit" }) as ToolDefinition) as unknown as Awaited<
          ReturnType<NonNullable<DeltaExtensionDependencies["loadEditPreview"]>>
        >["createDeltaEditTool"];
        return { createDeltaEditTool };
      },
    };
    registerDeltaExtension(enabled.pi, enabledDependencies);
    await enabled.sessionStart()?.({}, { cwd: "/repo" } as ExtensionContext);
    expect(enabledLoads).toBe(1);
    expect(enabled.registeredTools.map((tool) => tool.name)).toEqual(["git_diff", "edit"]);
  });

  test("loads execution implementation on the first tool call", async () => {
    const { pi, registeredTools } = createPi();
    let loads = 0;
    registerDeltaExtension(pi, {
      config: { editPreviews: false },
      loadExecution: async () => {
        loads += 1;
        return {
          executeDeltaProcess: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
          runDeltaEditDiff: async () => details,
          runDeltaGitDiff: async () => result,
        };
      },
    });
    expect(loads).toBe(0);
    const tool = registeredTools.find(({ name }) => name === "git_diff");
    if (tool?.execute === undefined) throw new Error("git_diff tool was not registered");
    await tool.execute("diff-1", {}, undefined, undefined, { cwd: "/repo" } as ExtensionContext);
    expect(loads).toBe(1);
  });
});
