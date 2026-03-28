---
name: pr-description
description: Write effective pull request description bodies that explain what changed, why it changed, reviewer focus, validation, and risk. Use when creating, reviewing, or improving PR descriptions for internal work, OSS contributions, infra changes, migrations, or WIP requests for early feedback.
---

# PR Description Bodies

This skill covers PR body writing only.

Do not define or rewrite PR title conventions here. Title format and type rules stay in command-specific prompts such as `.config/opencode/commands/pr-desc.md`.

## Core Principles

- Explain both `what changed` and `why it changed`; diffs already cover most of the what.
- Write for mixed audiences: current reviewers and future readers with less context.
- Ask for the right kind of feedback when needed (correctness, approach, UX, wording, risk).
- Keep prose compact; prefer concrete statements over filler.
- Scale detail by risk and uncertainty, not only by file count.

## PR Classification

Classify first, then choose sections.

| Class | Typical Signals | Required Sections | Common Optional Sections |
|---|---|---|---|
| Tiny | Rename, typo, narrow refactor | Summary, Changes | none |
| Normal | Typical feature or fix | Summary, Motivation, Changes | Testing |
| Risky | Migration, infra, security, breaking behavior | Summary, Motivation, Changes, Risk, Testing | Rollback, Deployment Notes |
| OSS-facing | External maintainers, less shared context | Summary, Motivation, Changes, Testing | Reviewer Focus, Linked Issues |
| WIP/Spike | Exploring approach or partial implementation | Summary, Motivation, Changes | Feedback Wanted, Readiness |

## Section Selection Rules

Use only the sections needed for the class and context.

- `## Summary`
  - 1-2 sentences.
  - State the outcome, not implementation trivia.
- `## Motivation`
  - Why this work exists now.
  - Link issue/ticket/design doc when available.
- `## Changes`
  - Verb-led bullets describing concrete code changes.
  - Keep bullets short and non-redundant.
- `## Risk`
  - What can fail, where blast radius exists, and conditions that increase risk.
- `## Testing`
  - How the change was validated (automated, manual, environment).
- `## Rollback` (risky only)
  - Fast reversal path and decision trigger.
- `## Feedback Wanted` (optional)
  - Explicitly request the kind of feedback needed.
- `## Readiness` (optional)
  - Mark WIP/spike/review-ready state and expected review depth.

## Writing Rules

- Start change bullets with plain verbs: `add`, `remove`, `change`, `fix`, `update`, `replace`, `move`, `extract`.
- Avoid first-person phrasing and avoid "this PR" narration.
- Avoid generic claims like "improves maintainability" unless you specify the concrete effect.
- Do not repeat `Summary` content in `Changes`.
- Ignore merge-only noise, formatting-only changes, whitespace-only diffs, and import reordering.
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

- Missing motivation section for non-trivial work.
- Wall of text with no headings.
- File-by-file diff narration instead of behavior-level changes.
- Vague summary: "misc updates" or "small fixes".
- Checklist theater with no actionable detail.

## Procedure

1. Classify the PR (`Tiny`, `Normal`, `Risky`, `OSS-facing`, `WIP/Spike`).
2. Select only required sections for that class.
3. Draft `Summary` and `Motivation` before `Changes`.
4. Add risk and validation details only where they materially affect review.
5. Add `Feedback Wanted` or `Readiness` for early-review or partial work.
6. Trim filler and duplicate statements.

## Output Contract for Downstream Commands

When this skill is used by a strict slash command, treat the command's formatting constraints as authoritative. This skill provides body-writing policy; command prompts provide exact output envelope.
