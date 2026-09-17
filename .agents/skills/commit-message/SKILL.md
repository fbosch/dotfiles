---
name: commit-message
description: Write or review concise Conventional Commit messages grounded in staged or supplied diffs. Use when asked for a Git commit message, commit subject, commit body, Conventional Commit, or Commitizen-style message. Do not use for release notes, changelogs, pull request descriptions, or general documentation.
---

# Commit messages

Write the smallest accurate message that identifies the change and its purpose.

## Gather evidence

- Use the supplied diff when the prompt contains one. Otherwise inspect the staged diff and relevant repository commit conventions.
- Ignore unstaged changes unless the user explicitly includes them.
- Treat branch names as scope evidence only. Do not claim intent that the diff, tests, issue reference, or user context does not support.
- Do not commit, stage, amend, or push unless the user explicitly requests that operation.

## Construct the message

Use `type(scope): subject` for the subject line.

Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.

- Choose the type from the observable effect, not the files changed.
- Determine scope before writing the subject. A recognized work item overrides every module or semantic scope.
- When the branch or prompt contains an Azure Boards work item, use exactly `AB#<number>` as the scope. For example, `feature/12345-session-expiration` requires `fix(AB#12345): ...`, never `fix(auth): ...`.
- Recognize `AB#12345`, `#12345`, and standalone work-item numbers of four or more digits in branch forms such as `feature/12345-description`.
- Never invent a ticket scope from numbers found only in source code or the diff.
- When no work item is present, use the shortest stable, unambiguous semantic scope, never a copied path. Keep an inferred scope at 12 characters or fewer; shorten compound names even when the longer form appears in a directory. Prefer `commit` over `commit-message`, `permission` over `pi-permission-system` or `dangerous-command`, and `api` over `api-and-interface-design`.
- Write the subject in imperative mood, lowercase, without a trailing period.
- Name the concrete behavior, rule, or outcome supported by the evidence. Do not replace it with generic verbs such as `update`, `improve`, `refine`, or `adjust` when the specific change fits.

## Enforce the 50-character gate

Treat 50 characters as a hard output constraint, not a preference.

1. Fix the type and scope before drafting the subject. Unless it is a required work-item scope, reject and shorten any scope longer than 12 characters.
2. Compute `prefix = f"{type}({scope}): "` and `subject_budget = 50 - len(prefix)`. If an output schema separates the fields, reconstruct this exact line before returning it.
3. Draft the shortest complete subject that preserves the observable outcome. Start with at most four words. Treat five or more words, or a conjunction such as `and`, as over-budget until an exact measurement proves otherwise.
4. Measure the reconstructed line exactly. If tools are available, use an exact operation such as Python `len(line)`. Otherwise count conservatively and target 45 characters or fewer rather than risking the boundary.
5. If the line exceeds 50 characters, shorten an inferred scope first, then remove redundant subject words or choose a shorter equivalent. Never shorten a required work-item scope, truncate a word, or return the over-limit draft.
6. Reconstruct and measure again after every rewrite. Do not return until `len(line) <= 50`.

Keep subjects grammatical and preserve required objects. For example:

- Reject `fix(hashline): preserve anchors when session files appear` (57); use `fix(hashline): preserve anchors on session load` (47).
- Reject `refactor(auth): delegate credential recovery to recovery service` (64); use `refactor(auth): delegate credential recovery` (44).
- Reject `docs(commit): enforce semantic scopes and line counting` (55); use `docs(commit): clarify scope and line limits` (43).
- Reject telegraphic shortening such as `count line`; shorten without changing meaning.
- Prefer specific outcomes over file narration. Avoid filler such as “this commit”, “now”, “currently”, “as requested”, AI attribution, and emoji.
- If only dependency lockfiles or generated lock state changed, use `chore(deps): update lock file`.

Add a body only when the user asks for one or the non-obvious reason cannot fit accurately in the subject. Separate it with a blank line. Explain the cause, rationale, or material consequence that the subject does not contain. Do not begin the body by restating the subject action or narrating the diff.

## Output

Return only the commit message unless the user requests analysis, alternatives, or another output envelope. A command or tool requiring JSON or another schema takes precedence over this default.

Before returning, verify that the message is supported by the provided evidence and follows any narrower repository convention. Return it only after an exact measurement confirms that the complete subject line—not only the text after the colon—is at most 50 characters.
