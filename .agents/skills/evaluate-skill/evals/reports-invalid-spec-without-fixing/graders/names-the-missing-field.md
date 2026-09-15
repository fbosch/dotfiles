---
type: llm
focus: last_message
weight: 2
---

The spec under validation has one task, "Broken task", that has a `prompt` but
neither an `expect` nor an `assert` field.

PASS if the response says the spec is invalid AND identifies that cause — that
the task is missing `expect`/`assert`, or lacks any success criterion.

FAIL if the response says the spec is valid, reports only unrelated errors, or
says it is invalid without naming the missing field.

Wording and formatting do not matter, and the response may also offer to fix it.
