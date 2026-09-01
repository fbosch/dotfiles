import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadFormatterSettings } from "../index";

test("disables formatting when trusted project settings cannot be parsed", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-formatter-settings-"));
  try {
    const agentDirectory = join(root, "agent");
    const projectDirectory = join(root, "project");
    await mkdir(join(projectDirectory, ".pi"), { recursive: true });
    await mkdir(agentDirectory);
    await writeFile(
      join(agentDirectory, "settings.json"),
      JSON.stringify({
        formatter: {
          rules: {
            typescript: {
              mode: "pipeline",
              files: { extensions: [".ts"] },
              commands: [{ command: "biome", args: ["format", "--write", "$FILE"] }],
            },
          },
        },
      }),
    );
    await writeFile(join(projectDirectory, ".pi", "settings.json"), '{"formatter":');
    const context = {
      cwd: projectDirectory,
      isProjectTrusted: () => true,
    } as unknown as ExtensionContext;

    const settings = loadFormatterSettings(context, agentDirectory);

    expect(settings.rules).toEqual([]);
    expect(settings.warnings).toHaveLength(1);
    expect(settings.warnings[0]).toContain("project settings");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("disables global formatters until the project is trusted", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-formatter-untrusted-"));
  try {
    const agentDirectory = join(root, "agent");
    const projectDirectory = join(root, "project");
    await mkdir(agentDirectory);
    await mkdir(projectDirectory);
    await writeFile(
      join(agentDirectory, "settings.json"),
      JSON.stringify({
        formatter: {
          rules: {
            markdown: {
              mode: "pipeline",
              files: { extensions: [".md"] },
              commands: [{ command: "prettier", args: ["--write", "$FILE"] }],
            },
          },
        },
      }),
    );
    const context = {
      cwd: projectDirectory,
      isProjectTrusted: () => false,
    } as unknown as ExtensionContext;

    const settings = loadFormatterSettings(context, agentDirectory);

    expect(settings.rules).toEqual([]);
    expect(settings.warnings).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
