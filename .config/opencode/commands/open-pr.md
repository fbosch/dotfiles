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

User-provided PR guidance:
$ARGUMENTS

Positional target branch argument, when explicitly supplied as a standalone branch:
$1

Argument handling:

- Treat all text in User-provided PR guidance as free-form instructions for the PR title and body. It may specify text to include, facts to look up, terminology to use, or follow-up work to mention.
- Do not interpret the first word of a natural-language instruction as a target branch. For example, `/open-pr mention that more changes will follow in later PRs` supplies PR guidance and no target branch.
- Treat `$1` as a target branch only when the invocation clearly supplies a standalone positional branch. Otherwise, leave `argument1` unset. If the guidance explicitly names a target or base branch, pass it as `targetBranch` instead.

Instructions:

1. Run in the current session context. Use recent conversation context and User-provided PR guidance as primary context.
2. Do not interpret provider routing yourself. The tool infers GitHub or Azure DevOps from git remotes. You may inspect the source remote only to decide whether a Codex review is available. Forward a clearly supplied positional target branch as `argument1`; if User-provided PR guidance explicitly names a target/base branch outside the positional argument, pass that value as `targetBranch`.
3. Inspect git only as needed to identify committed branch changes for the PR title/body. Prefer minimal checks: status, branch/base, commits, and diff against the target base.
4. Do not open a PR from only uncommitted working-tree changes. If the branch has no committed changes relative to base, output only `Cannot generate PR description: branch has no committed changes; commit local changes first.` and stop.
5. If base branch or merge-base cannot be determined, output only the matching `Cannot generate PR description:` error and stop.
6. If User-provided PR guidance requires repository, documentation, or external research to make the description accurate, you may spawn focused read-only subagents with the `task` tool. Give each subagent a bounded question, inspect and integrate its evidence, and do not delegate PR creation, pushing, or Codex-review selection. Do not spawn subagents when the guidance can be satisfied from the current context and minimal git inspection.
7. Generate PR content using the policy above: first line is `title`, remaining lines are markdown `body`.
8. For a GitHub source remote, use the `question` tool to ask whether to request a ChatGPT Codex review. Make `Yes, request Codex review` the first, recommended option and `No, skip review` the second. For an Azure DevOps source remote, do not ask; call `open_pr` exactly once with `requestCodexReview: false`. If the user selects Yes for GitHub, call `open_pr` exactly once with `requestCodexReview: true`; otherwise set `requestCodexReview: false`. Always include `title` and `body`. Include `argument1` only for an explicitly supplied positional target branch, and include `targetBranch` only when User-provided PR guidance explicitly names a target/base branch. Do not pass either branch field for free-form guidance such as the example above.
9. If tool output starts with `ERROR:`, output only that error and stop.
10. On success, output only the PR URL or success output returned by the tool.
