import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function commitSkillPath(home = homedir()): string {
  return join(home, ".agents", "skills", "commit-message", "SKILL.md");
}

export function loadCommitSkillPolicy(path = commitSkillPath()): string {
  let policy: string;
  try {
    policy = readFileSync(path, "utf8").trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load commit-message skill at ${path}: ${detail}`);
  }

  if (policy.length === 0) {
    throw new Error(`Commit-message skill is empty at ${path}`);
  }

  return policy;
}

export function buildCommitSystemPrompt(policy: string): string {
  return `${COMMIT_OUTPUT_CONTRACT}\n\n<commit-message-skill>\n${policy}\n</commit-message-skill>`;
}

const COMMIT_OUTPUT_CONTRACT = `Follow the commit-message skill policy below.
Output ONLY valid JSON and nothing else.
Required schema:
{"type":"feat|fix|docs|style|refactor|perf|test|build|ci|chore","scope":"string","subject":"string"}

Do not use markdown, backticks, explanations, prose, or tool calls.`;
