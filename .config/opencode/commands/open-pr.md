---
description: Open a pull request for the current branch on GitHub or Azure DevOps
---

Open a pull request for the current branch.

Use the `open_pr` tool for provider routing, pushing, and PR creation.
By default, target the repository's main branch. If the user provides another target branch, pass it to `open_pr` as `targetBranch`.

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

Argument 1:
$1

Argument 2:
$2

Instructions:

1. Run in the current session context. Use recent conversation context and Additional context as primary context.
2. Parse arguments before calling the tool. If `$1` is exactly `gh`, `github`, `az`, or `azure-devops`, treat `$1` as the provider override and `$2` as the optional target branch. Otherwise, treat `$1` as the optional target branch and omit the provider override. If Additional context explicitly names a target/base branch, use that value as the target branch.
3. Inspect git only as needed to identify committed branch changes for the PR title/body. Prefer minimal checks: status, branch/base, commits, and diff against the target base.
4. Do not open a PR from only uncommitted working-tree changes. If the branch has no committed changes relative to base, output only `Cannot generate PR description: branch has no committed changes; commit local changes first.` and stop.
5. If base branch or merge-base cannot be determined, output only the matching `Cannot generate PR description:` error and stop.
6. Generate PR content using the policy above: first line is `title`, remaining lines are markdown `body`.
7. If provider override is exactly `gh` or `github`, call `open_pr` with `provider: "gh"` plus `title`, `body`, and `targetBranch` when a target branch was provided.
8. If provider override is exactly `az` or `azure-devops`, call `open_pr` with `provider: "az"` plus `title`, `body`, and `targetBranch` when a target branch was provided.
9. Otherwise, call `open_pr` with `title`, `body`, and `targetBranch` when a target branch was provided.
10. Call `open_pr` exactly once.
11. If tool output starts with `ERROR:`, output only that error and stop.
12. On success, output only the PR URL or success output returned by the tool.
