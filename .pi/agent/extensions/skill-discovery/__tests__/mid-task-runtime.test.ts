import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const pi = Bun.which("pi");
test.skipIf(pi === null).each([false, true])(
  "installed Pi uses only natural turns for skill advice, terminating batch: %s",
  (terminating) => {
    const root = mkdtempSync(join(tmpdir(), "pi-mid-task-runtime-"));
    try {
      const agentDir = join(root, "agent");
      const project = join(root, "project");
      mkdirSync(join(agentDir, "skills", "gjs"), { recursive: true });
      mkdirSync(project);
      writeFileSync(join(agentDir, "settings.json"), "{}");
      writeFileSync(
        join(agentDir, "skills", "gjs", "SKILL.md"),
        "---\nname: gjs\ndescription: Diagnose GJS signal lifecycle\n---\nSKILL BODY MUST NOT BE LOADED\n",
      );
      const output = execFileSync(
        pi ?? "pi",
        [
          "--approve",
          "--no-extensions",
          "--no-session",
          "--no-prompt-templates",
          "--no-themes",
          "--offline",
          "--provider",
          "mid-task-fixture",
          "--model",
          "fixture",
          "--api-key",
          "fixture-not-a-real-key",
          "-e",
          resolve(import.meta.dir, "fixtures/mid-task-runtime.ts"),
          "-p",
          "Fix the widget",
        ],
        {
          cwd: project,
          env: {
            ...process.env,
            PI_CODING_AGENT_DIR: agentDir,
            PI_SKILL_TEST_TERMINATE: terminating ? "1" : "0",
          },
          encoding: "utf8",
          timeout: 30_000,
        },
      );
      const line = output.split("\n").find((value) => value.startsWith("MID_TASK_RUNTIME_CHECK "));
      expect(line).toBeDefined();
      expect(JSON.parse(line?.slice("MID_TASK_RUNTIME_CHECK ".length) ?? "{}")).toEqual({
        modelCalls: terminating ? 1 : 2,
        classifierCalls: terminating ? 1 : 2,
        sawAdvice: !terminating,
        adviceEntries: terminating ? 0 : 1,
        chatEntries: terminating ? 0 : 1,
      });
      expect(output).not.toContain("SKILL BODY MUST NOT BE LOADED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  40_000,
);
