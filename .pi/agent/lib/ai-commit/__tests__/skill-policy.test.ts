import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCommitSystemPrompt, commitSkillPath, loadCommitSkillPolicy } from "../skill-policy";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), "ai-commit-skill-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "SKILL.md");
  writeFileSync(path, contents);
  return path;
}

describe("commit skill policy", () => {
  test("resolves the global Agent Skills location", () => {
    expect(commitSkillPath("/home/fbb")).toBe("/home/fbb/.agents/skills/commit-message/SKILL.md");
  });

  test("loads the skill as the commit policy", () => {
    const path = temporaryFile("---\nname: commit-message\n---\n\nKeep messages concise.\n");

    expect(loadCommitSkillPolicy(path)).toContain("Keep messages concise.");
  });

  test("fails loudly when the skill is missing", () => {
    expect(() => loadCommitSkillPolicy("/missing/commit-message/SKILL.md")).toThrow(
      "Failed to load commit-message skill",
    );
  });

  test("places the skill inside the strict JSON envelope", () => {
    const prompt = buildCommitSystemPrompt("Keep the complete line within 50 characters.");

    expect(prompt).toContain("Output ONLY valid JSON");
    expect(prompt).toContain("<commit-message-skill>");
    expect(prompt).toContain("Keep the complete line within 50 characters.");
  });
});
