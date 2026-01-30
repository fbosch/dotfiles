---
name: token-usage-optimization
description: Estimate and optimize LLM token usage, cost, and latency for prompts, agents, and tool workflows. Use when asked to forecast token budgets, reduce prompt/context size, choose cheaper models, implement caching or summarization, or troubleshoot context length limits.
---

# Token Usage Estimation and Optimization

Deliver practical token estimates and a prioritized optimization plan without reducing output quality unnecessarily.

## Quick Start

1. Clarify the objective, target model(s), and constraints (budget, latency, max input/output tokens).
2. Inventory prompt components (system, developer, tool list, history, retrieved docs, user input).
3. Estimate tokens for each component and find the top 2-3 drivers.
4. Apply the smallest, highest-impact optimizations first.
5. Re-estimate and validate output quality.

## Estimation Heuristics

Use a tokenizer or estimation library when available. If not, use fast heuristics and add a buffer.

- **English prose**: tokens ≈ words * 1.3 or chars / 4
- **Code**: tokens ≈ chars / 3
- **JSON/structured**: tokens ≈ chars / 3.5
- **Buffer**: add 10-20% for safety

Template:

```text
input_tokens ≈ (system + tools + history + retrieval + user)
output_tokens ≈ target_response_length
total_tokens ≈ input_tokens + output_tokens
```

## Optimization Playbook

### Input Tokens

- **Trim tool list**: only include relevant tools for the request.
- **Conditional tool instructions**: include tool-specific guidance only when tool is present.
- **Prompt caching**: place stable instructions at the top for caching benefits.
- **Summarize history**: keep last N turns + compact summary + key decisions.
- **Reduce retrieval size**: tighten query, limit top-k, dedupe, and remove boilerplate.
- **Shorten system prompt**: remove redundant policies or examples.

### Output Tokens

- **Set caps**: use `max_tokens` or explicit length limits.
- **Constrain format**: bullet lists, tables, or schemas reduce verbosity.
- **Ask for concise**: specify maximum bullets, sentences, or words.

### Model Strategy

- **Use smaller models** for classification, routing, summarization, and labeling.
- **Escalate** to larger models only for complex reasoning or high-stakes outputs.

### Retry Reduction

- Return **structured error messages** with next steps to prevent retry loops.
- Make tool descriptions unambiguous to reduce misfires.

## Decision Trees

### Reduce Input Size

1. If prompt exceeds budget by <15% → trim tool list and boilerplate first.
2. If exceeded by 15-40% → summarize older history and remove low-value examples.
3. If exceeded by >40% → switch to retrieval + short summary + last N turns.
4. If still too large → move large static guidance to cached prefix or references.

### Choose Model Tier

1. Classification/routing/summarization → smallest available model.
2. Simple edits or formatting → small/fast model.
3. Complex reasoning or high-stakes → larger model.
4. If output quality drops → increase model tier before expanding context.

## NEVER List

- NEVER trim tool schemas or argument constraints; it causes invalid calls.
- NEVER drop safety or system constraints to save tokens.
- NEVER include unused tools; every tool adds token cost.
- NEVER summarize the last user request; keep it verbatim.
- NEVER compress examples that are required for format compliance.

## Agent-Specific Guidance

- Keep tool names and descriptions clear and specific.
- Filter tools before each call to avoid paying for unused tool metadata.
- Avoid stuffing large static instructions into every turn; move to cached prefix.

## Validation Checklist

- Recalculate token estimates after changes.
- Spot-check response quality vs baseline.
- Verify you did not remove critical instructions or constraints.
- Record changes and observed token deltas for future runs.

## Scripts

- `scripts/token_estimate.mjs`: fast token estimation via tokenx (approximate)

### token_estimate.mjs Usage

Requirements:

```bash
node + npx available on PATH
```

Estimate tokens from a file or raw text:

```bash
node scripts/token_estimate.mjs --file AGENTS.md
```

```bash
node scripts/token_estimate.mjs --text "Hello"
```

Tune conservatism with a custom chars-per-token value:

```bash
node scripts/token_estimate.mjs --file AGENTS.md --chars-per-token 4
```

## References

- Read `references/token-optimization-sources.md` only when asked for citations or rationale.
