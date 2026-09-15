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
- When no work item is present, use the shortest stable, unambiguous area as the scope. Treat the scope as a semantic label, not a directory name to copy verbatim. Follow an established repository scope when one exists; otherwise shorten a compound path to an accurate domain noun, such as `api-and-interface-design` to `api`.
- Write the subject in imperative mood, lowercase, without a trailing period.
- Name the concrete behavior, rule, or outcome supported by the evidence. Do not replace it with generic verbs such as `update`, `improve`, `refine`, or `adjust` when the specific change fits.
- Budget the complete line before drafting the subject: `subject_budget = 50 - len(f"{type}({scope}): ")`. Write a complete subject within that budget.
- Compose the full line and count its characters. If `len(line) > 50`, shorten an inferred scope first, then shorten the subject while preserving the outcome and every material distinction. Use a shorter phrase only when it has the same meaning; for example, do not change `line length` to `line count`. Never abbreviate a required work-item scope, estimate the count, or truncate a word.
- Read the shortened subject as a standalone sentence fragment. Every action must retain its required object, and every phrase must remain grammatical; reject telegraphic fragments such as `count line`.
- Before returning, use an exact character-count operation such as Python `len(subject_line)` on the composed line. Do not rely on mental counting. If the measured result exceeds 50, rewrite and measure again until it passes.
- Prefer specific outcomes over file narration. Avoid filler such as “this commit”, “now”, “currently”, “as requested”, AI attribution, and emoji.
- If only dependency lockfiles or generated lock state changed, use `chore(deps): update lock file`.

Add a body only when the user asks for one or the non-obvious reason cannot fit accurately in the subject. Separate it with a blank line. Explain the cause, rationale, or material consequence that the subject does not contain. Do not begin the body by restating the subject action or narrating the diff.

## Output

Return only the commit message unless the user requests analysis, alternatives, or another output envelope. A command or tool requiring JSON or another schema takes precedence over this default.

Before returning, verify that the message is supported by the provided evidence and follows any narrower repository convention. Return it only after an exact measurement confirms that the complete subject line—not only the text after the colon—is at most 50 characters.
