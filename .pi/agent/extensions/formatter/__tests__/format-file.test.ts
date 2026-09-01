import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FormatterExecutor, formatFile } from "../format-file";
import type { ResolvedFormatterSettings } from "../settings";

async function temporaryProject(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "pi-formatter-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("formatFile", () => {
  test("uses the first available command whose root requirements are satisfied", async () => {
    await temporaryProject(async (directory) => {
      const sourceDirectory = join(directory, "src");
      const filePath = join(sourceDirectory, "example.ts");
      await mkdir(sourceDirectory);
      await writeFile(filePath, "const value=1");
      const calls: Array<{ command: string; args: string[]; cwd: string | undefined }> = [];
      const execute: FormatterExecutor = async (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        return { stdout: "", stderr: "", code: 0, killed: false };
      };
      const settings: ResolvedFormatterSettings = {
        timeoutMs: 1_000,
        warnings: [],
        rules: [
          {
            id: "web",
            mode: "first_available",
            extensions: [".ts"],
            fileNames: [],
            commands: [
              {
                command: "biome",
                args: ["format", "--write", "$FILE"],
                requireRootMarker: true,
                rootMarkers: ["biome.json"],
              },
              {
                command: "prettier",
                args: ["--write", "$FILE"],
                requireRootMarker: false,
                rootMarkers: [],
              },
            ],
          },
        ],
      };

      expect(
        await formatFile({
          commandAvailable: async () => true,
          cwd: directory,
          execute,
          filePath,
          settings,
        }),
      ).toEqual([]);
      expect(calls).toEqual([{ command: "prettier", args: ["--write", filePath], cwd: directory }]);

      await writeFile(join(directory, "biome.json"), "{}");
      calls.length = 0;
      await formatFile({
        commandAvailable: async () => true,
        cwd: directory,
        execute,
        filePath,
        settings,
      });
      expect(calls).toEqual([
        {
          command: "biome",
          args: ["format", "--write", filePath],
          cwd: directory,
        },
      ]);
    });
  });

  test("runs pipeline commands in order and continues after a failure", async () => {
    await temporaryProject(async (directory) => {
      const filePath = join(directory, "example.lua");
      await writeFile(filePath, "return{}");
      const calls: string[] = [];
      const settings: ResolvedFormatterSettings = {
        timeoutMs: 2_000,
        warnings: [],
        rules: [
          {
            id: "lua",
            mode: "pipeline",
            extensions: [".lua"],
            fileNames: [],
            commands: [
              {
                command: "first",
                args: ["$FILE"],
                requireRootMarker: false,
                rootMarkers: [],
              },
              {
                command: "second",
                args: ["$FILE"],
                requireRootMarker: false,
                rootMarkers: [],
              },
            ],
          },
        ],
      };

      const warnings = await formatFile({
        commandAvailable: async () => true,
        cwd: directory,
        execute: async (command) => {
          calls.push(command);
          return command === "first"
            ? { stdout: "", stderr: "invalid input", code: 2, killed: false }
            : { stdout: "", stderr: "", code: 0, killed: false };
        },
        filePath,
        settings,
      });

      expect(calls).toEqual(["first", "second"]);
      expect(warnings).toEqual([
        `Formatter lua: first failed for ${filePath} (exit code 2): invalid input`,
      ]);
    });
  });
});
