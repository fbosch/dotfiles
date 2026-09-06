import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBashTool, createLocalBashOperations } from "@earendil-works/pi-coding-agent";
import { createSetupFragment } from "../index";

const temporaryPaths: string[] = [];
const RUNNER_BACKSTOP_SECONDS = 1;

async function fixtureDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pi-comma-runner-test-"));
  temporaryPaths.push(path);
  return path;
}

async function executable(path: string, source: string): Promise<void> {
  await writeFile(path, source);
  await chmod(path, 0o755);
}

async function eventuallyTerminated(pidPath: string): Promise<void> {
  const pid = Number((await readFile(pidPath, "utf8")).trim());
  expect(Number.isSafeInteger(pid)).toBe(true);

  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await Bun.sleep(20);
  }
  throw new Error(`descendant ${pid} remained after runner termination`);
}

async function recoveryFixture(phase: "resolver" | "execution") {
  const root = await fixtureDirectory();
  const store = join(root, "store");
  const bin = join(root, "bin");
  const resolved = join(store, "recovered");
  const resolverCount = join(root, "resolver-count");
  const executionCount = join(root, "execution-count");
  const descendantPid = join(root, "descendant.pid");
  await mkdir(store);
  await mkdir(bin);

  await executable(
    resolved,
    `#!/usr/bin/env bash
printf x >>${JSON.stringify(executionCount)}
sleep 30 &
printf '%s' "$!" >${JSON.stringify(descendantPid)}
printf execution-ready >&2
wait
`,
  );
  await executable(
    join(bin, "comma"),
    phase === "resolver"
      ? `#!/usr/bin/env bash
printf x >>${JSON.stringify(resolverCount)}
sleep 30 &
printf '%s' "$!" >${JSON.stringify(descendantPid)}
printf resolver-ready >&2
wait
printf '%s\\n' ${JSON.stringify(resolved)}
`
      : `#!/usr/bin/env bash
printf x >>${JSON.stringify(resolverCount)}
printf '%s\\n' ${JSON.stringify(resolved)}
`,
  );

  const setup = createSetupFragment({
    commaPath: join(bin, "comma"),
    pickerPath: join(root, "picker"),
    nixStore: store,
  });
  const tool = createBashTool(root, {
    commandPrefix: setup,
    operations: createLocalBashOperations(),
    // Match the direnv wrapper: adjust only the spawned invocation environment.
    spawnHook: ({ command, cwd, env }) => ({
      command,
      cwd,
      env: {
        ...env,
        PATH: `${bin}:${env.PATH ?? ""}`,
        TMPDIR: root,
        BASH_ENV: "",
        COMMA_ASK_TO_CONFIRM: "",
      },
    }),
  });

  return {
    descendantPid,
    executionCount,
    resolverCount,
    tool,
    command: `printf once >${JSON.stringify(join(root, "earlier-marker"))}; recovered`,
    marker: join(root, "earlier-marker"),
    ready: phase === "resolver" ? "resolver-ready" : "execution-ready",
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("pi-comma recovery through Pi's normal bash runner", () => {
  for (const phase of ["resolver", "execution"] as const) {
    test(
      `reports Pi timeout semantics and kills descendants during ${phase}`,
      async () => {
        const fixture = await recoveryFixture(phase);
        await expect(
          fixture.tool.execute("timeout", { command: fixture.command, timeout: 0.1 }),
        ).rejects.toThrow("Command timed out after 0.1 seconds");

        expect(await readFile(fixture.marker, "utf8")).toBe("once");
        expect(await readFile(fixture.resolverCount, "utf8")).toBe("x");
        if (phase === "resolver") {
          expect(await Bun.file(fixture.executionCount).exists()).toBe(false);
        } else {
          expect(await readFile(fixture.executionCount, "utf8")).toBe("x");
        }
        await eventuallyTerminated(fixture.descendantPid);
      },
      RUNNER_BACKSTOP_SECONDS * 2_000,
    );

    test(
      `reports Pi abort semantics and kills descendants during ${phase}`,
      async () => {
        const fixture = await recoveryFixture(phase);
        const controller = new AbortController();
        let aborted = false;
        const execution = fixture.tool.execute(
          "abort",
          { command: fixture.command, timeout: RUNNER_BACKSTOP_SECONDS },
          controller.signal,
          (update) => {
            const text = update.content
              .map((content) => (content.type === "text" ? content.text : ""))
              .join("");
            if (!aborted && text.includes(fixture.ready)) {
              aborted = true;
              controller.abort();
            }
          },
        );

        await expect(execution).rejects.toThrow("Command aborted");
        expect(aborted).toBe(true);
        expect(await readFile(fixture.marker, "utf8")).toBe("once");
        expect(await readFile(fixture.resolverCount, "utf8")).toBe("x");
        if (phase === "resolver") {
          expect(await Bun.file(fixture.executionCount).exists()).toBe(false);
        } else {
          expect(await readFile(fixture.executionCount, "utf8")).toBe("x");
        }
        await eventuallyTerminated(fixture.descendantPid);
      },
      RUNNER_BACKSTOP_SECONDS * 2_000,
    );
  }

  test("streams recovery output and preserves the spawn-hook working directory and environment", async () => {
    const root = await fixtureDirectory();
    const store = join(root, "store");
    const bin = join(root, "bin");
    const resolved = join(store, "recovered");
    await mkdir(store);
    await mkdir(bin);
    await executable(
      resolved,
      '#!/usr/bin/env bash\nprintf \'cwd=%s env=%s\\n\' "$PWD" "$PI_COMMA_RUNNER_ENV"\n',
    );
    await executable(join(bin, "comma"), `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(resolved)}\n`);

    const tool = createBashTool(root, {
      commandPrefix: createSetupFragment({
        commaPath: join(bin, "comma"),
        pickerPath: join(root, "picker"),
        nixStore: store,
      }),
      operations: createLocalBashOperations(),
      spawnHook: ({ command, cwd, env }) => ({
        command,
        cwd,
        env: {
          ...env,
          PATH: `${bin}:${env.PATH ?? ""}`,
          TMPDIR: root,
          BASH_ENV: "",
          COMMA_ASK_TO_CONFIRM: "",
          PI_COMMA_RUNNER_ENV: "preserved",
        },
      }),
    });
    const updates: string[] = [];
    const result = await tool.execute(
      "stream",
      { command: "recovered", timeout: 1 },
      undefined,
      (update) => {
        updates.push(
          update.content.map((content) => (content.type === "text" ? content.text : "")).join(""),
        );
      },
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining(`cwd=${root} env=preserved`),
    });
    expect(updates.some((text) => text.includes(`cwd=${root} env=preserved`))).toBe(true);
  });
});
