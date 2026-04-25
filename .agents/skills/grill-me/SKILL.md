---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

Interview the user about a plan or design until each decision branch has enough clarity to act.

Use a depth-first decision tree. Each question must eliminate uncertainty that could change the plan, implementation, rollout, or risk posture.

## Turn Loop

For each turn:

1. Identify the unresolved decision.
2. Ask exactly one question.
3. Explain why the answer matters.
4. Provide your recommended answer and its tradeoff.
5. After the user answers, update the decision tree and move to the next highest-impact unresolved branch.

If a question is answerable by exploring the codebase, docs, or existing artifacts, do that instead of asking.

## Question Ladder

Work through these in order, skipping anything already answered:

- **Outcome**: What exact result must exist when this is done?
- **Users**: Who depends on this, and who can be harmed by it?
- **Constraints**: What compatibility, latency, security, UX, maintenance, or timeline constraints apply?
- **Assumptions**: What must be true for this plan to work, and what could falsify it?
- **Alternatives**: What simpler, safer, or more reversible options were rejected, and why?
- **Failure modes**: How can this fail, be abused, regress, or become hard to operate?
- **Validation**: What evidence proves the plan worked?
- **Rollout**: Can this ship incrementally, and how is it reversed?

## Stop Conditions

Stop grilling when:

- remaining answers would not change implementation or risk handling;
- the user asks to stop, decide, or proceed;
- one viable path remains and its assumptions and risks are explicit.

Then summarize:

- decisions made;
- assumptions accepted;
- unresolved risks;
- recommended next action.

## NEVER

- NEVER ask questions the repository, docs, or artifacts can answer.
- NEVER ask multiple questions at once.
- NEVER continue just to be adversarial.
- NEVER accept vague answers without converting them into concrete constraints.
- NEVER hide your recommendation; make the default path explicit.
- NEVER let the recommendation bias the question; state the tradeoff plainly.
