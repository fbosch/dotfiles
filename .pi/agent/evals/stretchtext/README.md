# Stretchtext quality evaluation

An opt-in evaluator for the extension's writer prompt. The renderer, input handling,
and extension startup never call a classifier. No new dependencies are required.

## Run

1. From the repository root, write a local snapshot without provider requests:
   `bun .pi/agent/evals/stretchtext/evaluate.ts`.
2. Grade the 12 synthetic controls with the configured classifier:
   `bun .pi/agent/evals/stretchtext/evaluate.ts --live`.
3. Compare the frozen baseline with the current guide:
   `bun .pi/agent/evals/stretchtext/evaluate.ts --live --writer openai-codex/gpt-6.1-sol`.
4. Inspect `/tmp/pi-stretchtext-eval.json`, or select another report with `--out PATH`.

Hosted runs send only the authored synthetic requests, facts, and reply views.
They use Pi's existing credentials and classifier enablement settings. The live
path refreshes model-catalog metadata. Writer IDs must be canonical provider
model IDs, not extension aliases such as `-fast`.

## Grading

`fixtures.ts` contains labelled good and bad examples. `evaluate.ts` checks closed
stretches, single-line short forms, and unchanged words in order without AI.
Code spans and fences remain literal.

Three independent yes/no judgments inspect the collapsed and fully expanded reply:

- Does the collapsed reply omit an essential answer, action, blocker, validation
  limitation, or uncertainty?
- Does expansion contradict or materially weaken a collapsed claim?
- Does expansion add relevant information rather than repetition?

Labels, fixture IDs, and prompt-arm names are excluded from classifier state.
Each probability is thresholded at 0.5 for this pilot; values strictly between
0.2 and 0.8 are also counted as uncertain. These are reporting rules, not calibrated
production thresholds.

Writer comparisons start only when every control label matches. Each scenario
runs once per arm, alternating which arm goes first. Only pairs with successful
generation, valid structure, complete answers, and matching requested writer and
judge models are scored. Structural failures, missing answers, service errors,
and model mismatches are exclusions, never successful results. Incomplete runs
and control mistakes exit nonzero.

The report retains raw probabilities, failures, timings, requested model IDs,
writer replies, and hashes of both guides, the questions, controls, and scenarios.
Runs have a 180-second evaluation deadline, 10-second classifier deadlines,
30-second writer deadlines, and no writer retries. Without a writer there are
12 logical classifier requests; with one there are at most 20 classifier and
eight writer requests. Configured classifier fallback may add transport attempts.

## Prompt-development pilot

The first grader matched 31 of 36 labels. Clarifying its question polarity,
optional diagnostic detail, and comparison against the reader's collapsed view
raised the development-set result to 36 of 36 without changing the labels.
Three final probabilities remained in the uncertainty band.

The first canonical-writer comparison exposed a candidate violation: the short
form used `It`, but the expansion substituted `The service`. That pair was excluded,
not counted as a pass. The guide now says to draft the long form first and select
unchanged short-form words. It also keeps blockers, uncertainty, and incomplete
validation visible, including around closing blocks.

The final run used `openai-codex/gpt-6.1-sol` and
`openrouter/typesafe/jev-1.14`. All four pairs were scorable. Neither arm had a
flagged missing essential, changed claim, or redundant expansion. The final
artifact is `/tmp/pi-stretchtext-prompt-ab-final.json`.

This small, synthetic, unblinded development pilot does not demonstrate that the
revised guide outperforms the baseline. It found a concrete drafting failure and
provides a repeatable way to inspect later changes. The reply-level detail check
can miss one redundant stretch when another stretch adds useful information.
It does not establish factual accuracy, grammatical fit, or full Markdown validity.

## Regression checks

The non-hosted tests live in `__tests__/` and are included in
`test:pi-extensions` through `devenv test`. For a focused check:

```sh
cd .pi/agent && bun test evals/stretchtext extensions/stretchtext
```

Full devenv validation remains blocked by its home-directory error. Hosted
evaluation is never part of startup or the ordinary test suite.
