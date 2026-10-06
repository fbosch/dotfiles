import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const pi = Bun.which("pi");
test.skipIf(pi === null)(
  "installed Pi hides cold metadata while retaining search and scope defaults",
  () => {
    const root = mkdtempSync(join(tmpdir(), "pi-skill-runtime-"));
    try {
      const agentDir = join(root, "agent");
      const project = join(root, "project");
      const addSkill = (dir: string, name: string) => {
        const path = join(dir, "skills", name);
        mkdirSync(path, { recursive: true });
        writeFileSync(
          join(path, "SKILL.md"),
          `---\nname: ${name}\ndescription: ${name} specialized workflow\n---\nInstructions.\n`,
        );
      };
      addSkill(agentDir, "global-warm");
      addSkill(agentDir, "global-cold");
      addSkill(join(project, ".pi"), "local-warm");
      addSkill(join(project, ".pi"), "xstate");
      addSkill(join(project, ".pi"), "explicit-only");
      writeFileSync(
        join(agentDir, "settings.json"),
        JSON.stringify({
          classifier: { toolDiscovery: { enabled: false } },
          skillTweaks: { warmSkills: ["global-warm"], disableModelInvocation: ["explicit-only"] },
        }),
      );
      writeFileSync(
        join(project, ".pi", "settings.json"),
        JSON.stringify({ skillTweaks: { coldSkills: ["xstate"] } }),
      );
      const output = spawnSync(
        pi ?? "pi",
        [
          "--approve",
          "--no-extensions",
          "--no-session",
          "--no-prompt-templates",
          "--no-themes",
          "--offline",
          "--provider",
          "openai",
          "--model",
          "gpt-4o",
          "--api-key",
          "runtime-fixture-not-a-real-key",
          "-e",
          resolve(import.meta.dir, "../../skill-tweaks/index.ts"),
          "-e",
          resolve(import.meta.dir, "fixtures/runtime.ts"),
          "-p",
          "Verify skill filtering without generating a model response.",
        ],
        {
          cwd: project,
          env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
          encoding: "utf8",
          timeout: 30000,
        },
      );
      expect(output.error).toBeUndefined();
      expect(output.status).toBe(0);
      // Print mode reserves stdout for model output and routes extension logs to stderr.
      expect(output.stdout).toBe("");
      const line = output.stderr.split("\n").find((item) => item.startsWith("SKILL_RUNTIME_CHECK "));
      expect(line).toBeDefined();
      const report = JSON.parse(line?.slice("SKILL_RUNTIME_CHECK ".length) ?? "{}");
      expect(report.coldVisible).toBe(false);
      expect(report.globalColdVisible).toBe(false);
      expect(report.globalWarmVisible).toBe(true);
      expect(report.localWarmVisible).toBe(true);
      expect(report.explicitOnlyVisible).toBe(false);
      expect(report.searchResult).toContain("- xstate:");
      expect(report.searchResult).toContain("Ranking source: lexical");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  40000,
);
