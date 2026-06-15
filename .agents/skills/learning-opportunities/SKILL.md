---
name: learning-opportunities
description: Offer optional 10-15 minute deliberate learning exercises during AI-assisted coding. Use when the user asks for a learning opportunity, deliberate practice, retrieval check-in, prediction exercise, teach-back, or when substantial work created a good moment to offer learning. Do not use for ordinary implementation unless the user explicitly wants learning.
---

# Learning Opportunities

Use this skill to create deliberate learning moments during AI-assisted coding. The goal is durable understanding, not more code output.

Adapted from Dr. Cat Hicks' `learning-opportunities` project: https://github.com/DrCatHicks/learning-opportunities (CC-BY-4.0).

## Offer First

Do not start an exercise without consent. Offer one short prompt:

```text
Learning opportunity: [topic]. Want a 10-15 minute exercise?
```

Good moments to offer:

- New files or modules.
- Schema, config, or interface changes.
- Architecture decisions or refactors.
- Unfamiliar library, language, or pattern use.
- Any moment where the user asks `why`, `teach me`, `help me understand`, or `quiz me`.

Do not offer when:

- The user declined an exercise this session.
- The user already completed 2 exercises this session.
- The user is trying to ship direct implementation work.

## Hard Pause

When asking a learning question, end the message immediately after the question. Do not include hints, examples, suggested answers, parenthetical clues, or teaching content after the pause point.

Use:

```text
Your turn: [one specific question or task]
```

Then wait for the user. Wrong predictions are useful data.

## Exercise Menu

Choose one exercise type based on the user's goal:

- Prediction -> Observation -> Reflection: ask what should happen, inspect or run the smallest check, compare against reality.
- Generation -> Comparison: ask the user to sketch an approach before showing or discussing the existing one.
- Trace the path: walk through a request, value, event, or state transition one decision point at a time.
- Debug this: present a failure or edge case, ask what would go wrong and why, then test the hypothesis.
- Teach it back: ask the user to explain a component as if onboarding another developer.
- Retrieval check-in: ask what the user remembers from prior work before re-explaining it.

## Facilitation Rules

- Preserve productive effort. Do not answer your own question.
- Prefer directing the user to inspect files over showing code snippets.
- Use fading scaffolding: exact file/line first, subsystem later, then `where would you look?`.
- Give direct corrective feedback after the user answers: what holds, what breaks, why.
- Keep exercises small enough to fit the current task.
- Avoid production code, full functions, full files, or file edits during exercises.

## Response Shapes

Offer:

```text
Learning opportunity: [topic]. Want a 10-15 minute exercise?
```

Start:

```text
Exercise: [type]
Goal: [what this teaches]

Your turn: [one specific question or task]
```

After user answers:

```text
What holds: [correct part]
What breaks: [incorrect or incomplete part]
Next scaffold: [one smaller step]
```

Close:

```text
You now understand: [concept]
Try next: [small independent action]
Checkpoint: [one retrieval question]
```
