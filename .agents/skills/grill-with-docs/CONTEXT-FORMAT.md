# CONTEXT.md Format

## Structure

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A concise description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account

## Relationships

- An **Order** produces one or more **Invoices**
- An **Invoice** belongs to exactly one **Customer**

## Example dialogue

> **Dev:** "When a **Customer** places an **Order**, do we create the **Invoice** immediately?"
> **Domain expert:** "No — an **Invoice** is only generated once a **Fulfillment** is confirmed."

## Flagged ambiguities

- "account" was used to mean both **Customer** and **User** — resolved: these are distinct concepts.
```

## Rules

- Be opinionated. When multiple words exist for the same concept, pick the best one and list aliases to avoid.
- Flag conflicts explicitly. If a term is ambiguous, record the resolution under `Flagged ambiguities`.
- Keep definitions tight. One sentence max. Define what it is, not what it does.
- Show relationships. Use bold term names and express cardinality where obvious.
- Only include terms specific to this project's domain context. General programming concepts do not belong.
- Group terms under subheadings when natural clusters emerge. If all terms belong to one cohesive area, a flat list is fine.
- Write an example dialogue that shows how terms interact and clarifies boundaries between related concepts.

## Single vs multi-context repos

Single context: one `CONTEXT.md` at the repo root.

Multiple contexts: a root `CONTEXT-MAP.md` lists contexts, where they live, and how they relate to each other:

```md
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md) — receives and tracks customer orders
- [Billing](./src/billing/CONTEXT.md) — generates invoices and processes payments
- [Fulfillment](./src/fulfillment/CONTEXT.md) — manages warehouse picking and shipping

## Relationships

- **Ordering -> Fulfillment**: Ordering emits `OrderPlaced` events; Fulfillment consumes them to start picking
- **Fulfillment -> Billing**: Fulfillment emits `ShipmentDispatched` events; Billing consumes them to generate invoices
- **Ordering <-> Billing**: Shared types for `CustomerId` and `Money`
```

Infer the structure:

- If `CONTEXT-MAP.md` exists, read it to find contexts.
- If only a root `CONTEXT.md` exists, use single-context mode.
- If neither exists, create a root `CONTEXT.md` lazily when the first term is resolved.
- When multiple contexts exist, infer which one the current topic relates to. If unclear, ask one question.
