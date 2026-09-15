---
type: llm
focus: last_message
weight: 2
---

The user asked for a spec whose skill runs on Claude Code but whose judge is Codex.

PASS if the response gives a `caliper run` command that selects the two engines
separately at run time — a `--model` flag naming the skill engine (claude-code)
and a `--judge-model` flag naming the judge engine (codex) — and does not tell
the user to pin a backend, model, or judge inside the `.eval.yaml` file itself.

FAIL if the response puts the engine choice in the spec file (a `backend:`,
`model:`, or `judge:` key), omits `--judge-model`, or swaps the two engines so
that the judge is claude-code and the skill engine is codex.

Formatting, extra explanation, and surrounding prose do not matter — judge only
whether the two engines are selected independently at run time and assigned the
right way round.
