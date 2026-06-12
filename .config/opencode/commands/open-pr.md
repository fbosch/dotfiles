---
description: Open a pull request for the current branch on GitHub or Azure DevOps
---

Open a pull request for the current branch.

Use the `open_pr` tool for provider routing, pushing, and PR creation.

PR BODY POLICY (authoritative for body content only):

@~/.config/opencode/skills/pr-description/SKILL.md

TONE POLICY (authoritative for voice and phrasing only):

@~/.config/opencode/TONE.md

Follow this precedence order:

1. Tool invocation and provider routing rules from this command
2. PR body structure and content rules from `pr-description` skill
3. Voice and phrasing from `TONE.md`
4. If there is a conflict, command hard limits win

Additional context:
$ARGUMENTS

Provider override:
$1

Instructions:

1. Run in the current session context. Use recent conversation context and Additional context as primary context.
2. Inspect git only as needed to identify committed branch changes for the PR title/body. Prefer minimal checks: status, branch/base, commits, and diff against base.
3. Do not open a PR from only uncommitted working-tree changes. If the branch has no committed changes relative to base, output only `Cannot generate PR description: branch has no committed changes; commit local changes first.` and stop.
4. If base branch or merge-base cannot be determined, output only the matching `Cannot generate PR description:` error and stop.
5. Generate PR content using the policy above: first line is `title`, remaining lines are markdown `body`.
6. If Provider override is exactly `gh` or `github`, call `open_pr` with `provider: "gh"` plus `title` and `body`.
7. If Provider override is exactly `az` or `azure-devops`, call `open_pr` with `provider: "az"` plus `title` and `body`.
8. Otherwise, call `open_pr` with only `title` and `body`.
9. Call `open_pr` exactly once.
10. If tool output starts with `ERROR:`, output only that error and stop.
11. On success, output only the PR URL or success output returned by the tool.
