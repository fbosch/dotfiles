---
description: Create a new decision record in docs/decisions/
agent: build
---

Topic: $ARGUMENTS
Date: !`date +%Y-%m-%d`
Repo: !`basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"`
Existing decisions:
!`ls docs/decisions/*.md 2>/dev/null | sort | tail -10 || echo "(none yet)"`
Next number: !`printf "%04d" $(( $(ls docs/decisions/*.md 2>/dev/null | wc -l) + 1 ))`

---

If Topic is empty, respond only: "Usage: /decision <short decision statement>"

Create a decision record for the given topic using the information above.

1. Create the `docs/decisions/` directory if it does not exist.
2. First, write a one-line decision statement from the topic in the form `<verb> <object>` that makes the outcome explicit (for example: `use official RTK plugin`, `standardize on fish shell`); avoid vague slugs like `plugin-choice` or `shell-decision`.
3. Derive a kebab-case filename slug from that decision statement (lowercase, hyphens, no special chars).
4. Write the file to `docs/decisions/<Next number>-<slug>.md` using this template:

```
# <Title>

**Status:** proposed
**Date:** <Date>

## Context

<What situation or problem motivates this decision?>

## Decision

<What change or choice is being made?>

## Alternatives Considered

<What other options were evaluated and why were they not chosen?>

## Consequences

<What becomes easier or harder? Any follow-on work?>
```

Fill each section based on the topic and any context available from the current session. Keep sections concise — prefer 2–4 sentences each unless complexity demands more.

After writing the file, output only: the relative path to the created file.
