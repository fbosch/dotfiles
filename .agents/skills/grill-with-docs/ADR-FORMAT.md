# ADR Format

ADRs live in `docs/adr/` and use sequential numbering: `0001-slug.md`, `0002-slug.md`, etc.

Create the `docs/adr/` directory lazily, only when the first ADR is needed.

## Template

```md
# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
```

That's it. An ADR can be a single paragraph. The value is in recording that a decision was made and why, not in filling out sections.

## Optional sections

Only include these when they add genuine value. Most ADRs will not need them.

- **Status** frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`) — useful when decisions are revisited.
- **Considered Options** — only when rejected alternatives are worth remembering.
- **Consequences** — only when non-obvious downstream effects need to be called out.

## Numbering

Scan `docs/adr/` for the highest existing number and increment by one.

## When to offer an ADR

All three of these must be true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful.
2. **Surprising without context** — a future reader will look at the code and wonder why it was done this way.
3. **Real trade-off** — there were genuine alternatives and one was picked for specific reasons.

If a decision is easy to reverse, skip it. If it is not surprising, nobody will wonder why. If there was no real alternative, there is nothing to record beyond doing the obvious thing.

## What qualifies

- Architectural shape: monorepo, event sourcing, read/write model split.
- Integration patterns between contexts: domain events instead of synchronous HTTP.
- Technology choices that carry lock-in: database, message bus, auth provider, deployment target.
- Scope decisions: one context owns data; others reference it by ID only.
- Deliberate deviations from the obvious path: manual SQL instead of an ORM for a specific reason.
- Constraints not visible in code: compliance, latency, partner contracts, deployment limits.
- Rejected alternatives when the rejection is non-obvious and likely to be suggested again.
