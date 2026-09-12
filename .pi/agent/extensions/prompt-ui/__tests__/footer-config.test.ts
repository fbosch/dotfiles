import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FOOTER_CONFIG_FILE, loadFooterCustomization } from "../footer-config";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{ project: string; global: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi-footer-config-"));
  temporaryDirectories.push(root);
  const project = join(root, "project");
  const global = join(root, "global");
  await mkdir(join(project, ".pi"), { recursive: true });
  await mkdir(global, { recursive: true });
  return { project, global };
}

async function writeConfig(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

describe("footer customization", () => {
  test("prefers trusted project config over the global fallback", async () => {
    const { project, global } = await fixture();
    await writeFile(join(global, FOOTER_CONFIG_FILE), "{ malformed json\n");
    await writeConfig(join(project, ".pi", FOOTER_CONFIG_FILE), { icon: "project", color: "blue" });

    expect(loadFooterCustomization({ cwd: project, isProjectTrusted: () => true }, global)).toEqual(
      {
        icon: "project",
        color: "blue",
      },
    );
  });

  test("uses the global config for untrusted projects", async () => {
    const { project, global } = await fixture();
    await writeConfig(join(project, ".pi", FOOTER_CONFIG_FILE), { icon: "project" });
    await writeConfig(join(global, FOOTER_CONFIG_FILE), { icon: "global", color: "cyan" });

    expect(
      loadFooterCustomization({ cwd: project, isProjectTrusted: () => false }, global),
    ).toEqual({
      icon: "global",
      color: "cyan",
    });
  });

  test("returns no customization when neither layer is configured", async () => {
    const { project, global } = await fixture();

    expect(
      loadFooterCustomization({ cwd: project, isProjectTrusted: () => true }, global),
    ).toBeUndefined();
  });

  test("rejects invalid icon and color values", async () => {
    const { project, global } = await fixture();
    const configPath = join(project, ".pi", FOOTER_CONFIG_FILE);

    await writeConfig(configPath, { icon: "bad\nicon" });
    expect(() =>
      loadFooterCustomization({ cwd: project, isProjectTrusted: () => true }, global),
    ).toThrow(".icon");

    await writeConfig(configPath, { icon: "", color: "chartreuse" });
    expect(() =>
      loadFooterCustomization({ cwd: project, isProjectTrusted: () => true }, global),
    ).toThrow(".color");

    await writeConfig(configPath, { icon: "", color: "1;34" });
    expect(() =>
      loadFooterCustomization({ cwd: project, isProjectTrusted: () => true }, global),
    ).toThrow(".color");

    await writeConfig(configPath, { icon: "", color: "constructor" });
    expect(() =>
      loadFooterCustomization({ cwd: project, isProjectTrusted: () => true }, global),
    ).toThrow(".color");
  });
});
