import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    env: { ...Bun.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: await process.exited,
    stdout: await new Response(process.stdout).text(),
    stderr: await new Response(process.stderr).text(),
  };
}

function fakePi(source = "builtin") {
  const handlers = new Map<
    string,
    (event: { toolName: string; input: { command: string } }) => void
  >();
  const pi = {
    getAllTools: () => [
      {
        name: "bash",
        description: "Bash",
        parameters: {},
        sourceInfo: {
          source,
          path: source === "builtin" ? "<builtin:bash>" : "<bash>",
          scope: "temporary",
          origin: "top-level",
        },
      },
    ],
    on: (
      event: string,
      handler: (event: { toolName: string; input: { command: string } }) => void,
    ) => {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  return { handlers, pi };
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("pi-comma", () => {
  test("stays inactive when comma is absent or the bash backend is custom", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = await fixtureDirectory();
    try {
      const absent = fakePi();
      await piCommaExtension(absent.pi);
      expect(absent.handlers.size).toBe(0);
    } finally {
      process.env.PATH = originalPath;
    }

    const bin = await fixtureDirectory();
    await executable(join(bin, "comma"), "#!/bin/sh\nexit 0\n");
    process.env.PATH = bin;
    try {
      const custom = fakePi("local");
      await piCommaExtension(custom.pi);
      expect(custom.handlers.size).toBe(0);
    } finally {
      process.env.PATH = originalPath;
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
