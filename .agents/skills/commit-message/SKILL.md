---
name: commit-message
description: Write, review, revise, or shorten any commit message, especially Conventional Commits, including a requested subject and body. Use whenever asked to create or correct a commit message, subject, or body based on staged or supplied changes; enforce type, scope, and subject-length limits. Do not use for release notes, changelogs, pull request descriptions, or general documentation.
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


Treat a proposed subject as a draft, not as binding format: reconstruct its type and scope from the evidence, then apply every rule below. Do not keep an overlong or path-copied scope merely because the draft used it.
## Enforce the 50-character gate

Treat 50 characters as a hard output constraint, not a preference.

1. Fix the type and scope before drafting the subject. Unless it is a required work-item scope, reject and shorten any scope longer than 12 characters.
2. Compute `prefix = f"{type}({scope}): "` and `subject_budget = 50 - len(prefix)`. If an output schema separates the fields, reconstruct this exact line before returning it.
3. Draft one short, grammatical clause naming the concrete outcome. Preserve its required direct object and omit optional detail first; keep inferred-scope subjects to at most four words. For mandatory ticket scopes, compress the clause to fit its smaller budget—for example, `fix(AB#12345): reduce session lifetime`. Do not use fragments such as `persist before ack` or join clauses with `and` or a semicolon.
4. Before returning, run an exact character-count check on the complete subject, including type and scope (for example, `len(f"{type}({scope}): {subject}")` in Python); never rely on a visual estimate. If the line exceeds 50, rewrite and measure again. Without a Python or shell tool, count conservatively and target 45 characters or fewer. A requested body does not extend the subject budget.
5. If it exceeds 50, shorten an inferred scope first. Never alter a required work-item scope or truncate a word; rewrite the clause as a shorter grammatical equivalent and preserve its concrete outcome.
6. Reconstruct and measure again after every rewrite. Return only when the complete subject is at most 50 characters.

Keep subjects grammatical and preserve required objects. For example:

- Reject `fix(hashline): preserve anchors when session files appear` (57); use `fix(hashline): preserve session anchors` (39).
- With a required ticket scope, use `fix(AB#9876543210): persist delivery before ack` (47), never `fix(AB#9876543210): persist before ack` (38).
- With scope `AB#12345`, reject `fix(AB#12345): shorten session expiration to one hour` (53); use `fix(AB#12345): reduce session lifetime` (38).
- For a requested body, use `fix(worker): persist delivery id before ack` (43) as the subject; explain the restart window in the body instead of repeating the subject.
- With `fix(permission)`, reject `fix(permission): deny recursive root deletion commands` (54); use `fix(permission): deny recursive root deletion` (45).
- Reject `refactor(auth): delegate credential recovery to recovery service` (64); use `refactor(auth): delegate credential recovery` (44).
- For combined guidance about semantic scopes and measuring the complete subject, use `docs(commit): clarify scope and subject limits` (46); preserve both outcomes rather than mentioning only the length check.
- Reject telegraphic shortening such as `count line`; shorten without changing meaning.
- Prefer specific outcomes over file narration. Avoid filler such as “this commit”, “now”, “currently”, “as requested”, AI attribution, and emoji.
- If only dependency lockfiles or generated lock state changed, use `chore(deps): update lock file`.

Honor a requested body, but first finalize a subject within 50 characters. Separate it with one blank line and use it only for a distinct cause, rationale, or consequence. Start with that cause or consequence, not the subject’s action and object: for `fix(worker): persist delivery id before ack`, write `A restart in that gap could redeliver the message`, not `Persist the id before acknowledging...`. Do not repeat or paraphrase the subject or narrate the diff.

## Output

Return only the commit message unless the user requests analysis, alternatives, or another output envelope. Honor explicit destinations: when asked to save the message or a JSON object to a file, write the exact requested artifact there before returning it; the chat response must match the saved content. A command or tool requiring JSON or another schema takes precedence over this default.

Before returning, verify that the message is supported by the provided evidence and follows any narrower repository convention. Return it only after an exact measurement confirms that the complete subject line—not only the text after the colon—is at most 50 characters.
