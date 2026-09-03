---
description: Create a concise architecture decision record in docs/adr/
argument-hint: "<short decision statement>"
agent: general
inherit_context: true
usage: "Usage: /decision <short decision statement>"
---

Create an architecture decision record for this topic:

$ARGUMENTS

If the topic is empty, respond only:
`Usage: /decision <short decision statement>`

Before writing:

1. Read `.agents/skills/domain-modeling/SKILL.md` and `.agents/skills/domain-modeling/ADR-FORMAT.md`.
2. Inspect the existing records in `docs/adr/` and follow their established style.
3. Find the highest existing numeric ADR filename and use the next number. Do not use the file count, and never overwrite an existing file.
4. Use the current date from the system, not a date inferred from the conversation.

Write `docs/adr/<NNNN>-<slug>.md`:

- Derive a clear, imperative decision statement from the topic.
- Derive a lowercase kebab-case slug from that statement.
- Use `accepted` only when the decision is already adopted in the repository; use `proposed` for a future decision.
- Include `# Title`, `**Status:**`, and `**Date:**`.
- Include concise `## Context`, `## Decision`, `## Alternatives Considered`, and `## Consequences` sections when they add information. Follow the existing repository convention rather than inventing generic filler.
- Base the record on repository evidence and the current conversation. Do not invent alternatives, measurements, or implementation details.

After writing, output only the relative path to the created file.
