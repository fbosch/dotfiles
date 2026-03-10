---
description: Minimal agent for commit message generation — no provider system prompt, no tools
mode: primary
hidden: true
# model: openai/gpt-5.3-codex-spark
# model: anthropic/claude-haiku-4-5
model: openai/gpt-5.1-codex-mini
# model: opencode/big-pickle
prompt: ""
permission: deny
tools:
  "*": false
---

Output ONLY valid JSON and nothing else.
Required schema:
{"type":"feat|fix|docs|style|refactor|perf|test|build|ci|chore","scope":"string","subject":"string"}

Rules:

- No markdown, no backticks, no explanations, no prose.
- `type` must be one of: feat, fix, docs, style, refactor, perf, test, build, ci, chore.
- `scope`: use AB#<n> if ticket exists in branch/args, else module/feature name.
- `subject`: imperative mood, lowercase, no trailing period, specific and substantive.
- If only lock/generated files are staged, output exactly:
  {"type":"chore","scope":"deps","subject":"update lock file"}
- Keep final formatted message `type(scope): subject` within 50 chars whenever possible.
- Prefer short wording: authentication->auth, implement->add, function->fn.
