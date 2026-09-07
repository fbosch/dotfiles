---
description: Open a pull request for the current branch on GitHub or Azure DevOps
argument-hint: "[target branch or guidance]"
---

Open a pull request for the current branch.

Use the available GitHub or Azure DevOps CLI workflow (`gh`/`az`) for provider detection, target branch selection, pushing, and PR creation.

PR BODY POLICY (authoritative for body content only):

Read and apply `.agents/skills/pr-description/SKILL.md`.

TONE POLICY (authoritative for voice and phrasing only):

Read and apply `~/.config/fbb/TONE.md`.

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
2. Detect the provider from git remotes and select the target branch with `gh` or `az`. Forward a clearly supplied positional target branch as the target branch; if User-provided PR guidance explicitly names a target/base branch outside the positional argument, use that value.
3. Inspect git only as needed to identify committed branch changes for the PR title/body. Prefer minimal checks: status, branch/base, commits, and diff against the target base.
4. Do not open a PR from only uncommitted working-tree changes. If the branch has no committed changes relative to base, output only `Cannot generate PR description: branch has no committed changes; commit local changes first.` and stop.
5. If base branch or merge-base cannot be determined, output only the matching `Cannot generate PR description:` error and stop.
6. If User-provided PR guidance requires repository, documentation, or external research to make the description accurate, you may spawn focused read-only subagents with the `subagent` tool. Give each subagent a bounded question, inspect and integrate its evidence, and do not delegate PR creation, pushing, or Codex-review selection. Do not spawn subagents when the guidance can be satisfied from the current context and minimal git inspection.
7. Generate PR content using the policy above: first line is `title`, remaining lines are markdown `body`.
8. For a GitHub source remote, use the `ask_user_question` tool to ask whether to request a ChatGPT Codex review. Make `Yes, request Codex review` the first, recommended option and `No, skip review` the second. For an Azure DevOps source remote, do not ask. Push the branch and create the PR with the appropriate `gh` or `az` command, requesting a Codex review only when the user selected Yes for GitHub. Always include the generated title and body, and pass an explicitly supplied target branch only when one was provided.
9. If the provider CLI reports an `ERROR:`, output only that error and stop.
10. On success, output only the PR URL or success output returned by the provider CLI.
