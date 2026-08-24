import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const publisher = resolve(import.meta.dir, "../runtime-artifacts.sh");
const temporaryDirectories: string[] = [];

interface Fixture {
  configDirectory: string;
  environment: Record<string, string>;
  runtimeDirectory: string;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content);
  await chmod(path, 0o755);
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "ags-runtime-artifacts-"));
  temporaryDirectories.push(root);
  const configDirectory = join(root, "config");
  const runtimeDirectory = join(root, "runtime");
  const binDirectory = join(root, "bin");
  const sources = [
    "config-bundled.tsx",
    "config-about-this-pc.tsx",
    "components/ai-pointer/index.tsx",
    "components/ai-pointer/accessibility/helper.ts",
  ];
  await Promise.all(
    sources.map(async (source) => {
      const path = join(configDirectory, source);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "");
    }),
  );
  await mkdir(runtimeDirectory, { mode: 0o700 });
  await mkdir(binDirectory);
  await writeExecutable(
    join(binDirectory, "ags"),
    `#!/usr/bin/env bash
source_path="\${@: -2:1}"
output_path="\${@: -1}"
if [[ "\${FAIL_ABOUT_THIS_PC:-}" == "1" && "$source_path" == *config-about-this-pc.tsx ]]; then
  exit 1
fi
printf '#!/usr/bin/env bash\n' > "$output_path"
chmod 755 "$output_path"
`,
  );
  await writeExecutable(
    join(binDirectory, "python3"),
    `#!/usr/bin/env bash
output_path="\${@: -1}"
printf 'export {}\n' > "$output_path"
chmod 600 "$output_path"
`,
  );
  await writeExecutable(join(binDirectory, "ags-bundle-runtime"), "#!/usr/bin/env bash\n");
  return {
    configDirectory,
    runtimeDirectory,
    environment: {
      ...process.env,
      AGS_CONFIG_DIR: configDirectory,
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
      XDG_RUNTIME_DIR: runtimeDirectory,
    },
  };
}

function runPublisher(fixture: Fixture, command: string) {
  return Bun.spawnSync({
    cmd: ["bash", "-c", `source "$1"; ${command}`, "runtime-artifacts-test", publisher],
    env: fixture.environment,
  });
}

function outputLines(output: Uint8Array): string[] {
  return new TextDecoder().decode(output).trim().split("\n");
}

test("session publication owns immutable paths and artifact permissions", async () => {
  const fixture = await createFixture();

  const result = runPublisher(
    fixture,
    `publish_runtime_artifacts session || exit 1
printf '%s\n' \
  "$AGS_BUNDLED_EXECUTABLE_PATH" \
  "$AGS_ABOUT_THIS_PC_EXECUTABLE_PATH" \
  "$AGS_AI_POINTER_ACCESSIBILITY_HELPER_PATH" \
  "$AGS_AI_POINTER_MODULE_PATH" \
  "$AGS_RUNTIME_ARTIFACT_GENERATION_DIR" \
  "$RUNTIME_ARTIFACT_BUNDLED_HOST_READY"`,
  );

  expect(result.exitCode).toBe(0);
  const [bundledHost, aboutThisPC, helper, module, generation, bundledHostReady] = outputLines(
    result.stdout,
  );
  expect(generation).toMatch(/ags-runtime-session-[A-Za-z0-9]+$/);
  expect(dirname(generation)).toBe(fixture.runtimeDirectory);
  expect(bundledHost).toBe(join(generation, "ags-bundled-executable"));
  expect(aboutThisPC).toBe(join(generation, "ags-about-this-pc-executable"));
  expect(helper).toBe(join(generation, "ags-ai-pointer-accessibility-helper"));
  expect(module).toBe(join(generation, "ags-ai-pointer-module.js"));
  expect(bundledHostReady).toBe("true");
  expect((await stat(bundledHost)).mode & 0o111).not.toBe(0);
  expect((await stat(aboutThisPC)).mode & 0o111).not.toBe(0);
  expect((await stat(helper)).mode & 0o111).not.toBe(0);
  expect((await stat(module)).mode & 0o777).toBe(0o600);
});

test("source-host cleanup removes its complete generation", async () => {
  const fixture = await createFixture();
  const result = runPublisher(
    fixture,
    `publish_runtime_artifacts source-host || exit 1
module="$AGS_AI_POINTER_MODULE_PATH"
helper="$AGS_AI_POINTER_ACCESSIBILITY_HELPER_PATH"
cleanup_runtime_artifacts
printf '%s\n' "$module" "$helper" "$RUNTIME_ARTIFACT_BUNDLED_HOST_READY"`,
  );

  expect(result.exitCode).toBe(0);
  const [module, helper, bundledHostReady] = outputLines(result.stdout);
  expect(await Bun.file(module).exists()).toBe(false);
  expect(await Bun.file(helper).exists()).toBe(false);
  expect(bundledHostReady).toBe("false");
  expect(await Bun.file(join(dirname(helper), "ags-bundled-executable")).exists()).toBe(false);
});

test("session publication keeps the source fallback when About This PC bundling fails", async () => {
  const fixture = await createFixture();
  fixture.environment.FAIL_ABOUT_THIS_PC = "1";

  const result = runPublisher(
    fixture,
    `publish_runtime_artifacts session || exit 1
printf '%s\n' \
  "$RUNTIME_ARTIFACT_WARNING" \
  "$RUNTIME_ARTIFACT_BUNDLED_HOST_READY" \
  "$AGS_ABOUT_THIS_PC_EXECUTABLE_PATH"`,
  );

  expect(result.exitCode).toBe(0);
  const [warning, bundledHostReady, aboutThisPC] = outputLines(result.stdout);
  expect([warning, bundledHostReady]).toEqual([
    "Failed to build About This PC; source fallback will be used",
    "true",
  ]);
  expect(await Bun.file(aboutThisPC).exists()).toBe(false);
});

test("a new session publication cannot replace another host generation", async () => {
  const fixture = await createFixture();
  const result = runPublisher(
    fixture,
    `publish_runtime_artifacts session || exit 1
first_generation="$AGS_RUNTIME_ARTIFACT_GENERATION_DIR"
first_module="$AGS_AI_POINTER_MODULE_PATH"
first_helper="$AGS_AI_POINTER_ACCESSIBILITY_HELPER_PATH"
publish_runtime_artifacts session || exit 1
printf '%s\n' \
  "$first_generation" \
  "$first_module" \
  "$first_helper" \
  "$AGS_RUNTIME_ARTIFACT_GENERATION_DIR"`,
  );

  expect(result.exitCode).toBe(0);
  const [firstGeneration, firstModule, firstHelper, secondGeneration] = outputLines(result.stdout);
  expect(secondGeneration).not.toBe(firstGeneration);
  expect(await Bun.file(firstModule).exists()).toBe(true);
  expect(await Bun.file(firstHelper).exists()).toBe(true);
});

test("a failed strict bundle leaves the previous generation intact", async () => {
  const fixture = await createFixture();
  const result = runPublisher(
    fixture,
    `publish_runtime_artifacts bundle || exit 1
first_generation="$AGS_RUNTIME_ARTIFACT_GENERATION_DIR"
first_about="$AGS_ABOUT_THIS_PC_EXECUTABLE_PATH"
export FAIL_ABOUT_THIS_PC=1
if publish_runtime_artifacts bundle; then
  exit 1
fi
printf '%s\n' "$first_generation" "$first_about" "$AGS_RUNTIME_ARTIFACT_GENERATION_DIR"`,
  );

  expect(result.exitCode).toBe(0);
  const [firstGeneration, firstAbout, failedGeneration] = outputLines(result.stdout);
  expect(await Bun.file(firstAbout).exists()).toBe(true);
  expect((await stat(firstGeneration)).isDirectory()).toBe(true);
  expect(await Bun.file(failedGeneration).exists()).toBe(false);
});

test("rejects a shared runtime directory before publishing files", async () => {
  const fixture = await createFixture();
  const evidence = join(fixture.runtimeDirectory, "evidence");
  await writeFile(evidence, "preserve");
  await chmod(fixture.runtimeDirectory, 0o755);

  const result = runPublisher(fixture, "publish_runtime_artifacts session");

  expect(result.exitCode).not.toBe(0);
  expect(await Bun.file(evidence).text()).toBe("preserve");
  expect(new TextDecoder().decode(result.stderr)).toBe("");
});
