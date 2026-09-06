import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import piCommaExtension, { createSetupFragment, isCommaAvailable } from "../index";

const temporaryPaths: string[] = [];

async function fixtureDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pi-comma-test-"));
  temporaryPaths.push(path);
  return path;
}

async function executable(path: string, source: string): Promise<void> {
  await writeFile(path, source);
  await chmod(path, 0o755);
}

async function runBash(
  command: string,
  environment: Record<string, string>,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const process = Bun.spawn(["bash", "-c", command], {
    cwd: environment.TMPDIR ?? tmpdir(),
    env: { ...Bun.env, BASH_ENV: "", ENV: "", COMMA_ASK_TO_CONFIRM: "", ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: await process.exited,
    stdout: await new Response(process.stdout).text(),
    stderr: await new Response(process.stderr).text(),
  };
}

const DIRENV_EXTENSION_PATH = realpathSync(join(import.meta.dir, "..", "..", "direnv", "index.ts"));

type BashSource = { source: string; path: string };

function fakePi(
  sourceInfo: BashSource = { source: "builtin", path: "<builtin:bash>" },
  rejectFactoryActions = false,
) {
  let runtimeReady = !rejectFactoryActions;
  let metadataCalls = 0;
  const handlers = new Map<
    string,
    (event: { toolName: string; input: { command: string; timeout?: number } }) => void
  >();
  const pi = {
    getAllTools: () => {
      metadataCalls++;
      if (!runtimeReady)
        throw new Error("action methods cannot be called during extension loading");
      return [
        {
          name: "bash",
          description: "Bash",
          parameters: {},
          sourceInfo: { ...sourceInfo, scope: "temporary", origin: "top-level" },
        },
      ];
    },
    on: (
      event: string,
      handler: (event: { toolName: string; input: { command: string; timeout?: number } }) => void,
    ) => {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  return {
    handlers,
    pi,
    get metadataCalls() {
      return metadataCalls;
    },
    dispatchToolCall(event: { toolName: string; input: { command: string; timeout?: number } }) {
      runtimeReady = true;
      handlers.get("tool_call")?.(event);
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("pi-comma", () => {
  test("stays inactive when comma is absent", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = await fixtureDirectory();
    try {
      const absent = fakePi();
      await piCommaExtension(absent.pi);
      expect(absent.handlers.size).toBe(0);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  test("defers metadata and accepts only built-in Bash or this direnv wrapper", async () => {
    const originalPath = process.env.PATH;
    const originalPiMarker = process.env.PI_CODING_AGENT;
    const bin = await fixtureDirectory();
    const direnvSymlink = join(await fixtureDirectory(), "index.ts");
    await executable(join(bin, "comma"), "#!/bin/sh\nexit 0\n");
    await symlink(DIRENV_EXTENSION_PATH, direnvSymlink);
    process.env.PATH = bin;
    process.env.PI_CODING_AGENT = "true";
    try {
      const cases: Array<{ sourceInfo: BashSource; mutates: boolean }> = [
        { sourceInfo: { source: "builtin", path: "<builtin:bash>" }, mutates: true },
        { sourceInfo: { source: "extension", path: DIRENV_EXTENSION_PATH }, mutates: true },
        { sourceInfo: { source: "extension", path: direnvSymlink }, mutates: true },
        {
          sourceInfo: { source: "extension", path: "/tmp/unrelated/direnv/index.ts" },
          mutates: false,
        },
        { sourceInfo: { source: "sdk", path: "/tmp/custom-bash.ts" }, mutates: false },
        { sourceInfo: { source: "extension", path: "/missing/bash.ts" }, mutates: false },
      ];

      for (const { sourceInfo, mutates } of cases) {
        const harness = fakePi(sourceInfo, true);
        await piCommaExtension(harness.pi);
        expect(harness.metadataCalls).toBe(0);

        const call = { toolName: "bash", input: { command: "echo original", timeout: 12_345 } };
        harness.dispatchToolCall(call);
        expect(harness.metadataCalls).toBe(1);
        expect(call.input.timeout).toBe(12_345);
        if (mutates) {
          expect(call.input.command).toContain("command_not_found_handle");
          expect(call.input.command).toEndWith("\necho original");
        } else {
          expect(call.input.command).toBe("echo original");
        }
      }
    } finally {
      process.env.PATH = originalPath;
      process.env.PI_CODING_AGENT = originalPiMarker;
    }
  });

  test("rejects broken and timed-out comma startup checks", async () => {
    const bin = await fixtureDirectory();
    const broken = join(bin, "broken-comma");
    const slow = join(bin, "slow-comma");
    await executable(broken, "#!/bin/sh\nexit 2\n");
    await executable(slow, "#!/bin/sh\nsleep 1\n");
    expect(await isCommaAvailable(broken, 50)).toBe(false);
    expect(await isCommaAvailable(slow, 10)).toBe(false);
  });

  test("activates after reload when comma becomes available", async () => {
    const originalPath = process.env.PATH;
    const bin = await fixtureDirectory();
    process.env.PATH = bin;
    try {
      const before = fakePi();
      await piCommaExtension(before.pi);
      expect(before.handlers.size).toBe(0);

      await executable(join(bin, "comma"), "#!/bin/sh\nexit 0\n");
      const after = fakePi();
      await piCommaExtension(after.pi);
      expect(after.handlers.has("tool_call")).toBe(true);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  test("recovers once while preserving arguments, stdin, stdout, and exit status", async () => {
    const root = await fixtureDirectory();
    const store = join(root, "store");
    const bin = join(root, "bin");
    await mkdir(store);
    await mkdir(bin);
    const resolved = join(store, "resolved");
    const log = join(root, "comma.log");
    await executable(
      resolved,
      '#!/usr/bin/env bash\nprintf \'args=%s|%s|%s\\n\' "$1" "$2" "$3"\ncat\nexit 7\n',
    );
    await executable(
      join(bin, "comma"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >>${JSON.stringify(log)}\nprintf '%s\\n' ${JSON.stringify(resolved)}\n`,
    );
    const picker = join(import.meta.dir, "..", "ambiguous-picker.sh");
    const setup = createSetupFragment({
      commaPath: join(bin, "comma"),
      pickerPath: picker,
      nixStore: store,
    });
    const result = await runBash(
      `cd ${JSON.stringify(root)}\n${setup}\nprintf once >> marker && printf json | missing-tool 'two words' '' '$(not-run)'`,
      { PATH: `${bin}:${process.env.PATH}`, TMPDIR: root },
    );

    expect(result.exitCode).toBe(7);
    expect(await readFile(join(root, "marker"), "utf8")).toBe("once");
    expect(result.stdout).toBe("args=two words||$(not-run)\njson");
    expect(result.stderr).toContain("pi-comma: resolving missing-tool");
    expect(await readFile(log, "utf8")).toContain("--print-path");
  });

  test("does not invoke comma for existing commands, paths, functions, or an existing handler", async () => {
    const root = await fixtureDirectory();
    const log = join(root, "comma.log");
    const comma = join(root, "comma");
    await executable(comma, `#!/bin/sh\nprintf called >>${JSON.stringify(log)}\nexit 1\n`);
    const setup = createSetupFragment({ commaPath: comma, pickerPath: comma, nixStore: root });
    const result = await runBash(
      `command_not_found_handle() { printf existing >&2; return 44; }\n${setup}\nprintf '{"ok":true}\\n'\nfalse-command() { return 127; }\nfalse-command\n./not-here\nanother-missing`,
      { TMPDIR: root },
    );
    expect(result.exitCode).toBe(44);
    expect(result.stderr).toContain("existing");
    expect(await Bun.file(log).exists()).toBe(false);
  });

  test("does not recover permission errors or an existing executable that returns 127", async () => {
    const root = await fixtureDirectory();
    const comma = join(root, "comma");
    const blocked = join(root, "blocked");
    const returns127 = join(root, "returns-127");
    const log = join(root, "comma.log");
    await executable(comma, `#!/bin/sh\nprintf called >>${JSON.stringify(log)}\n`);
    await executable(blocked, "#!/bin/sh\necho blocked\n");
    await chmod(blocked, 0o644);
    await executable(returns127, "#!/bin/sh\nexit 127\n");
    const setup = createSetupFragment({ commaPath: comma, pickerPath: comma, nixStore: root });
    const result = await runBash(
      `${setup}\n./blocked; blocked; returns-127; missing-path/command`,
      { PATH: `${root}:${process.env.PATH}`, TMPDIR: root },
    );

    expect(result.exitCode).toBe(127);
    expect(await Bun.file(log).exists()).toBe(false);
  });

  test("keeps JSON stdout and command substitution clean while recovering", async () => {
    const root = await fixtureDirectory();
    const store = join(root, "store");
    const comma = join(root, "comma");
    const resolved = join(store, "json-tool");
    await mkdir(store);
    await executable(resolved, "#!/bin/sh\nprintf '{\\\"ok\\\":true}'\n");
    await executable(comma, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(resolved)}\n`);
    const setup = createSetupFragment({ commaPath: comma, pickerPath: comma, nixStore: store });
    const result = await runBash(
      `${setup}\nvalue=$(json-tool); printf '%s\\n' "$value" > result.json; cat result.json`,
      { TMPDIR: root },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('{"ok":true}\n');
    expect(result.stderr).toContain("pi-comma: resolving json-tool");
  });

  test.each([0, 7, 127])("preserves resolved exit %i without retrying", async (status) => {
    const root = await fixtureDirectory();
    const comma = join(root, "comma");
    const tool = join(root, "tool");
    await executable(tool, `#!/bin/sh\nprintf run >> "$TMPDIR/runs"\nexit ${status}\n`);
    await executable(
      comma,
      `#!/bin/sh\nprintf lookup >> "$TMPDIR/lookups"\nprintf '%s\\n' '${tool}'\n`,
    );
    const setup = createSetupFragment({ commaPath: comma, pickerPath: comma, nixStore: root });
    const result = await runBash(`${setup}\nprintf once >> before; pi-comma-status-fixture`, {
      TMPDIR: root,
    });
    expect(result.exitCode).toBe(status);
    expect(result.stdout).toBe("");
    expect(await readFile(join(root, "runs"), "utf8")).toBe("run");
    expect(await readFile(join(root, "lookups"), "utf8")).toBe("lookup");
    expect(await readFile(join(root, "before"), "utf8")).toBe("once");
  });

  test.each([
    "nul",
    "empty",
    "extra-newline",
    "control",
    "missing",
    "not-executable",
    "failed-build",
    "missing-index",
  ])("rejects %s resolver output before execution", async (failure) => {
    const root = await fixtureDirectory();
    const comma = join(root, "comma");
    const tool = join(root, "tool");
    await executable(tool, '#!/bin/sh\nprintf ran > "$TMPDIR/ran"\n');
    if (failure === "not-executable") await chmod(tool, 0o644);
    const outputs: Record<string, string> = {
      nul: `printf '%s\\0\\n' '${tool}'`,
      empty: "exit 0",
      "extra-newline": `printf '%s\\n\\n' '${tool}'`,
      control: `printf '%s\\r\\n' '${tool}'`,
      missing: `printf '%s\\n' '${root}/disappeared'`,
      "not-executable": `printf '%s\\n' '${tool}'`,
      "failed-build": "printf '%s\\n' /bin/echo; printf 'build failed\\n' >&2; exit 1",
      "missing-index": "printf 'index missing\\n' >&2; exit 1",
    };
    await executable(comma, `#!/bin/sh\n${outputs[failure]}\n`);
    const setup = createSetupFragment({ commaPath: comma, pickerPath: comma, nixStore: root });
    const result = await runBash(`${setup}\nset -e; pi-comma-failure-fixture`, { TMPDIR: root });
    expect(result.exitCode).toBe(127);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("pi-comma:");
    expect(await Bun.file(join(root, "ran")).exists()).toBe(false);
  });

  test("resolution cannot read redirected input, and helper failures cannot recurse", async () => {
    const root = await fixtureDirectory();
    const comma = join(root, "comma");
    const tool = join(root, "tool");
    await writeFile(join(root, "input"), "literal stdin\n");
    await executable(tool, "#!/bin/sh\ncat\n");
    await executable(
      comma,
      `#!/bin/sh\nif IFS= read -r line; then exit 9; fi\nprintf '%s\\n' '${tool}'\n`,
    );
    const setup = createSetupFragment({ commaPath: comma, pickerPath: comma, nixStore: root });
    const result = await runBash(`${setup}\npi-comma-input-fixture < input`, { TMPDIR: root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("literal stdin\n");
    await rm(comma);
    const disappeared = await runBash(`${setup}\npi-comma-input-fixture`, { TMPDIR: root });
    expect(disappeared.exitCode).toBe(127);
    expect(disappeared.stderr.match(/pi-comma: resolving/g)).toHaveLength(1);
  });

  test("normal commands stay silent without relying on an existing handler", async () => {
    const root = await fixtureDirectory();
    const comma = join(root, "comma");
    await executable(comma, '#!/bin/sh\nprintf called > "$TMPDIR/lookup"\nexit 1\n');
    await executable(join(root, "existing"), "#!/bin/sh\nexit 127\n");
    const setup = createSetupFragment({ commaPath: comma, pickerPath: comma, nixStore: root });
    const result = await runBash(
      `${setup}\nprintf ok; local_function() { return 0; }; local_function; existing`,
      {
        TMPDIR: root,
        PATH: `${root}:${process.env.PATH}`,
      },
    );
    expect(result.exitCode).toBe(127);
    expect(result.stdout).toBe("ok");
    expect(result.stderr).toBe("");
    expect(await Bun.file(join(root, "lookup")).exists()).toBe(false);
  });

  test("smoke script reaches the handler without a download", async () => {
    const root = await fixtureDirectory();
    await executable(join(root, "comma"), '#!/bin/sh\nprintf lookup > "$TMPDIR/lookup"\nexit 1\n');
    const smoke = join(import.meta.dir, "..", "smoke-real-comma.sh");
    const result = await runBash(`'${smoke}' pi-comma-smoke-fixture`, {
      TMPDIR: root,
      PATH: `${root}:${process.env.PATH}`,
      COMMA_ASK_TO_CONFIRM: "1",
    });
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain(
      "pi-comma: automatic recovery cannot bypass COMMA_ASK_TO_CONFIRM",
    );
    expect(await Bun.file(join(root, "lookup")).exists()).toBe(false);
  });

  test("rejects traversal, multiline output, and confirmation-required recovery", async () => {
    const root = await fixtureDirectory();
    const store = join(root, "store");
    const comma = join(root, "comma");
    const resolved = join(store, "tool");
    await mkdir(store);
    await executable(resolved, "#!/bin/sh\nprintf should-not-run\n");
    await executable(
      comma,
      `#!/bin/sh
case "$5" in
  traversal) printf '%s\\n' ${JSON.stringify(`${store}/../tool`)} ;;
  multiline) printf '%s\\n%s\\n' ${JSON.stringify(resolved)} ${JSON.stringify(resolved)} ;;
  *) printf '%s\\n' ${JSON.stringify(resolved)} ;;
esac
`,
    );
    const setup = createSetupFragment({ commaPath: comma, pickerPath: comma, nixStore: store });
    const traversal = await runBash(`${setup}\ntraversal`, { TMPDIR: root });
    const multiline = await runBash(`${setup}\nmultiline`, { TMPDIR: root });
    const confirmation = await runBash(`${setup}\nconfirmed`, {
      TMPDIR: root,
      COMMA_ASK_TO_CONFIRM: "true",
    });

    expect(traversal.exitCode).toBe(127);
    expect(multiline.exitCode).toBe(127);
    expect(confirmation.exitCode).toBe(127);
    expect(`${traversal.stdout}${multiline.stdout}${confirmation.stdout}`).toBe("");
    expect(confirmation.stderr).toContain("COMMA_ASK_TO_CONFIRM");
  });

  test("has no shared resolver state across concurrent Bash invocations", async () => {
    const root = await fixtureDirectory();
    const store = join(root, "store");
    const comma = join(root, "comma");
    const resolved = join(store, "tool");
    await mkdir(store);
    await executable(resolved, "#!/bin/sh\nprintf '%s' \"$1\"\n");
    await executable(comma, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(resolved)}\n`);
    const setup = createSetupFragment({ commaPath: comma, pickerPath: comma, nixStore: store });
    const [first, second] = await Promise.all([
      runBash(`${setup}\nconcurrent one`, { TMPDIR: root }),
      runBash(`${setup}\nconcurrent two`, { TMPDIR: root }),
    ]);

    expect(first.stdout).toBe("one");
    expect(second.stdout).toBe("two");
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
  });

  test("reports ambiguity and rejects invalid and injected resolver output", async () => {
    const root = await fixtureDirectory();
    const comma = join(root, "comma");
    const picker = join(import.meta.dir, "..", "ambiguous-picker.sh");
    await executable(
      comma,
      `#!/usr/bin/env bash
picker=""
while (( $# )); do
  case "$1" in --picker) picker="$2"; shift 2;; --) shift; break;; *) shift;; esac
done
case "$1" in
  ambiguous) printf 'first\\nlast' | "$picker";;
  injected) printf '%s\\n%s\\n' ${JSON.stringify(join(root, "not-real"))} '$(touch injected)';;
  *) printf '%s\\n' /bin/echo;;
esac
`,
    );
    const setup = createSetupFragment({ commaPath: comma, pickerPath: picker, nixStore: root });
    const ambiguous = await runBash(`${setup}\nambiguous`, { TMPDIR: root });
    expect(ambiguous.exitCode).toBe(127);
    expect(ambiguous.stdout).toBe("");
    expect(ambiguous.stderr).toContain("candidate: last");

    const injected = await runBash(`${setup}\ninjected`, { TMPDIR: root });
    expect(injected.exitCode).toBe(127);
    expect(await Bun.file(join(root, "injected")).exists()).toBe(false);
    expect(injected.stderr).toContain("invalid executable path");
  });
});
