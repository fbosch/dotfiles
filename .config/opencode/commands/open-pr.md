---
description: Open a pull request for the current branch on GitHub or Azure DevOps
---

Open a pull request for the current branch.

Use the `open_pr` tool for provider detection, target branch selection, pushing, and PR creation.

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

Target branch argument:
$1

Instructions:

1. Run in the current session context. Use recent conversation context and Additional context as primary context.
2. Do not interpret provider routing yourself. The tool infers GitHub or Azure DevOps from git remotes. Forward Target branch argument as `argument1`; if Additional context explicitly names a target/base branch outside the positional argument, pass that value as `targetBranch`.
3. Inspect git only as needed to identify committed branch changes for the PR title/body. Prefer minimal checks: status, branch/base, commits, and diff against the target base.
4. Do not open a PR from only uncommitted working-tree changes. If the branch has no committed changes relative to base, output only `Cannot generate PR description: branch has no committed changes; commit local changes first.` and stop.
5. If base branch or merge-base cannot be determined, output only the matching `Cannot generate PR description:` error and stop.
6. Generate PR content using the policy above: first line is `title`, remaining lines are markdown `body`.
7. Call `open_pr` exactly once with `title`, `body`, `argument1`, and `targetBranch` only when target branch came from Additional context rather than Target branch argument.
8. If tool output starts with `ERROR:`, output only that error and stop.
9. On success, output only the PR URL or success output returned by the tool.
