import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  loadStartupHeaderArt,
  renderStartupHeaderArt,
  STARTUP_HEADER_ART_FILE,
  STARTUP_HEADER_CONFIG_FILE,
} from "../ascii-art";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("startup header ASCII art", () => {
  test("prefers trusted project art over the global fallback", async () => {
    const root = await temporaryRoot();
    const project = join(root, "project");
    const home = join(root, "home");
    await writeArt(join(project, ".pi", STARTUP_HEADER_ART_FILE), "$1project\n");
    await writeArt(join(home, ".pi", "agent", STARTUP_HEADER_ART_FILE), "$2global\n");

    expect(loadStartupHeaderArt({ cwd: project, isProjectTrusted: () => true }, home)).toEqual({
      lines: ["$1project"],
      colors: {},
    });
  });

  test("uses global art when project art is absent or untrusted", async () => {
    const root = await temporaryRoot();
    const project = join(root, "project");
    const home = join(root, "home");
    await writeArt(join(project, ".pi", STARTUP_HEADER_ART_FILE), "project");
    await writeArt(join(home, ".pi", "agent", STARTUP_HEADER_ART_FILE), "global");

    expect(loadStartupHeaderArt({ cwd: project, isProjectTrusted: () => false }, home)).toEqual({
      lines: ["global"],
      colors: {},
    });
  });

  test("loads project colors and renders Fastfetch hex mappings", async () => {
    const root = await temporaryRoot();
    const project = join(root, "project");
    await writeArt(join(project, ".pi", STARTUP_HEADER_ART_FILE), "$1dark $2light");
    await writeArt(
      join(project, ".pi", STARTUP_HEADER_CONFIG_FILE),
      JSON.stringify({ color: { "1": "#4d6fb7", "2": "#77b6e1" } }),
    );
    const art = loadStartupHeaderArt(
      { cwd: project, isProjectTrusted: () => true },
      join(root, "home"),
    );
    const theme = {
      fg: (_color: string, text: string) => text,
      getColorMode: () => "truecolor",
    } as Theme;

    expect(art?.colors).toEqual({ "1": "#4d6fb7", "2": "#77b6e1" });
    expect(renderStartupHeaderArt(theme, 80, art)[0]).toBe(
      "\u001b[38;2;77;111;183mdark \u001b[39m\u001b[38;2;119;182;225mlight\u001b[39m",
    );
  });
  test("renders Fastfetch color markers, escaped dollars, and bounded lines", () => {
    const theme = {
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    } as Theme;
    const colored = renderStartupHeaderArt(theme, 80, {
      lines: ["$1pi $$ $2ready"],
      colors: {},
    });
    const clipped = renderStartupHeaderArt(theme, 12, {
      lines: ["$1pi $$ $2ready and long"],
      colors: {},
    });

    expect(colored[0]).toContain("<accent>pi $ </accent>");
    expect(colored[0]).toContain("<success>ready</success>");
    expect(visibleWidth(clipped[0] ?? "")).toBeLessThanOrEqual(12);
  });

  test("keeps the built-in pi mark when no art file exists", () => {
    const theme = { fg: (color: string, text: string) => `<${color}>${text}` } as Theme;
    expect(renderStartupHeaderArt(theme, 80, undefined)).toEqual(["<accent>pi"]);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "startup-header-art-"));
  temporaryDirectories.push(root);
  return root;
}

async function writeArt(path: string, content: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}
