---
name: pr-description
description: Write effective pull request description bodies that explain what changed, why it changed, reviewer focus, validation, and risk. Use when creating, reviewing, or improving PR descriptions for internal work, OSS contributions, infra changes, migrations, or WIP requests for early feedback.
---

# PR Description Bodies

This skill covers PR body writing only.

Do not define or rewrite PR title conventions here. Title format and type rules stay in command-specific prompts such as `~/.config/opencode/commands/pr-desc.md`.

## Core Principles

- Start with the smallest useful PR body; add detail only when complexity, risk, audience, or uncertainty justifies it.
- Explain both `what changed` and `why it changed`; diffs already cover most of the what.
- Write for mixed audiences: current reviewers and future readers with less context.
- Ask for the right kind of feedback when needed (correctness, approach, UX, wording, risk).
- Put the review-relevant point first; do not make reviewers dig through setup prose.
- Keep prose compact; prefer concrete consequences, examples, and limits over filler or broad claims.
- Scale detail by risk and uncertainty, not only by file count.
- Use the `writing-clearly` skill for final PR prose; task-specific output contracts and hard limits still win.

## Voice And Priority

Before writing or editing final PR prose, read `~/.config/opencode/TONE.md` when it exists. If a repo-local `.config/opencode/TONE.md` also exists, use it only when the task explicitly asks for repo-local voice.

Use this priority order when instructions conflict:

1. Factual correctness and verified evidence.
2. Explicit user constraints for this PR.
3. Required output contract from a command, tool, template, or maintainer.
4. `~/.config/opencode/TONE.md`.
5. This skill's general PR-writing guidance.

## PR Classification

Classify first, then choose sections. Default to `Tiny` unless the change needs more context for review.

| Class | Typical Signals | Required Sections | Common Optional Sections |
|---|---|---|---|
| Tiny | Rename, typo, narrow refactor, obvious local fix | Summary | Changes, Testing |
| Normal | Typical feature or fix | Summary, Changes | Motivation, Testing |
| Risky | Migration, infra, security, breaking behavior | Summary, Changes, Risk | Motivation, Testing, Rollback, Deployment Notes |
| OSS-facing | External maintainers, less shared context | Summary, Changes | Motivation, Testing, Reviewer Focus, Linked Issues |
| WIP/Spike | Exploring approach or partial implementation | Summary, Changes | Motivation, Feedback Wanted, Readiness |

## Section Selection Rules

Use only the sections needed for the class and context.

Add a section only when it changes reviewer behavior, preserves non-obvious context, explains risk, or records validation that future readers would need.

- `## Summary`
  - 1-2 sentences.
  - State the outcome, not implementation trivia.
  - Use `writing-clearly` for the final wording: concrete, direct, and free of generic claims.
- `## Motivation`
  - Why this work exists now.
  - Link issue/ticket/design doc when available.
  - Omit when `Summary` already gives enough context or the rationale is obvious.
  - Include when the reason, timing, tradeoff, or linked context materially changes review.
- `## Changes`
  - Verb-led bullets describing concrete code changes.
  - Keep bullets short and non-redundant.
  - Omit for tiny PRs when `Summary` fully explains the change.
- `## Risk`
  - What can fail, where blast radius exists, and conditions that increase risk.
- `## Testing`
  - How the change was validated (automated, manual, environment).
  - Omit when validation is redundant or obvious from the change context.
  - Include when validation materially affects reviewer confidence, risk assessment, release readiness, or reproducibility.
- `## Rollback` (risky only)
  - Fast reversal path and decision trigger.
- `## Feedback Wanted` (optional)
  - Explicitly request the kind of feedback needed.
- `## Readiness` (optional)
  - Mark WIP/spike/review-ready state and expected review depth.

## Writing Rules

- Follow `writing-clearly` for practical, direct, concrete, low-ceremony prose.
- Keep language simple and easy to read; prefer short sentences and specific technical nouns.
- Prefer active voice unless passive voice keeps focus on the changed behavior or risk.
- Prefer positive, direct statements over negated or hedged phrasing.
- Start change bullets with plain verbs: `add`, `remove`, `change`, `fix`, `update`, `replace`, `move`, `extract`.
- Avoid first-person phrasing and avoid "this PR" narration.
- Avoid generic claims like "improves maintainability", "more robust", or "better DX" unless you specify the concrete effect or failure mode avoided.
- Do not repeat `Summary` content in `Changes`.
- Ignore merge-only noise, formatting-only changes, whitespace-only diffs, and import reordering.
- Keep caveats proportional; include tradeoffs and limits only when they affect review, rollout, or future debugging.
- Prefer explicit reviewer guidance over long explanation.

## Audience Adaptation

- Internal team:
  - Assume moderate shared context, but still include motivation for non-obvious choices.
- OSS maintainers:
  - Assume minimal context.
  - Include rationale, linked issue, and exact validation steps.
- Infra or migration reviewers:
  - Optimize for risk assessment.
  - Include risk, rollback, and rollout expectations.

## Anti-Patterns

- Redundant motivation section that repeats `Summary` or states the obvious.
- Wall of text with no headings.
- File-by-file diff narration instead of behavior-level changes.
- Vague summary: "misc updates" or "small fixes".
- Praise-padding before useful criticism, risk, or reviewer asks.
- Marketing tone, consultant polish, generic enthusiasm, or long introductions before the point.
- Checklist theater with no actionable detail, including redundant `Testing` sections that only restate obvious checks.

## Procedure

1. Classify the PR (`Tiny`, `Normal`, `Risky`, `OSS-facing`, `WIP/Spike`).
2. Start from `Summary` only, then add sections only when the change justifies them.
3. Draft `Summary` before `Changes`; add `Motivation` only when explicitly relevant.
4. Replace broad claims with concrete consequences, examples, or limits.
5. Add risk and validation details only where they materially affect review; omit `Testing` when it would be redundant or obvious.
6. Add `Feedback Wanted` or `Readiness` for early-review or partial work.
7. Trim filler, duplicate statements, and repeated caveats.
8. Final-check that the first sentence states the purpose, each section has one job, and every claim is concrete enough to verify.

## Output Contract for Downstream Commands

When this skill is used by a strict slash command, treat the command's formatting constraints as authoritative. This skill provides body-writing policy; command prompts provide exact output envelope.
