# Compacted-fact model evaluation

`context-compacted-facts.ts` measures whether the answering agent can recover facts after real compaction. It uses the production context-masking extension, hosted compaction and recall classifiers, and an actual SDK agent session. It does not substitute deterministic classifier answers.

## Run

The hosted run uses authenticated model access and incurs provider usage. It writes synthetic histories, checkpoints, answers, and traces to a private temporary directory. It does not alter live settings.

1. Synchronize the installed SDK:
   ```sh
   bun run --cwd .pi/agent sdk:sync
   ```
2. Inspect the model, profile, sample size, and request limits without making model calls:
   ```sh
   bun run --cwd .pi/agent benchmarks/context-compacted-facts.ts
   ```
3. Run the hosted evaluation:
   ```sh
   bun run --cwd .pi/agent benchmarks/context-compacted-facts.ts --run
   ```

The default `receipt` scenario remains the smaller regression cohort: three seeded histories of 1,000 facts, with 24 sampled fact questions per history. Each batch also has two unanswerable questions. Use `--seeds=trial-a,trial-b --questions=16` to change the cohort. The question count must fit the pool of facts absent from retained context.

The `diverse` preset uses five reproducible seeds and 100 sampled facts per history. It balances identifiers, numbers, paths, dates, and Danish text. Half the questions are paraphrased; 20 of the 100 target revised values.

```sh
bun run --cwd .pi/agent benchmarks/context-compacted-facts.ts --scenario=diverse --run
```

Use unused `--seeds` values for a new held-out cohort. The campaign deadline scales by 15 minutes per configured seed, giving a five-seed run 75 minutes in total. The per-operation deadline and request limits stay unchanged. The reports include breakdowns by fact type, wording, their combination, and revision status.

Inside Pi, the evaluator inherits `PI_PROVIDER`, `PI_MODEL`, and `PI_REASONING_LEVEL`. Otherwise it uses global model settings. It resolves credentials through the existing auth-profile selection and credential-store composition, rather than assuming `auth.json` owns the Codex credential. Profile selection follows trusted-repository, host, and global preferences; it does not copy a live session's manual profile override or provider pin. The evaluator uses Pi's existing fast-tier payload adapter for `-fast` model aliases.

## What counts as retrieval

The evaluator seeds historical tool results, then calls `session.compact()`. It checks that all 1,000 current facts entered the compacted prefix and remain in validated archives. It selects questions only afterward, excluding facts still present in the checkpoint or retained tail. Selection includes revised-value challenges and seeded samples across old, middle, and recent records.

Both arms start each batch from the same checkpoint:

- `combined` enables explicit recall and automatic prefetch.
- `explicit-only` disables prefetch so the answering agent must retrieve evidence itself.

The prompt gives question IDs and natural-language questions, without source paths or expected values. The agent can use `recall`, tool discovery, and reads of cataloged archives. Original workspace files and evaluator answer keys are inaccessible. Every archive path passes the read guard before probing, and archive contents are checked again after the run.

Answers are scored as exact strings or `null`. Reports include stale answers, invalid response schemas, abstentions, model-input evidence coverage, tool calls, prefetch coverage, and provider usage. Each batch has a private trace file. A completed run is not necessarily a quality pass: the command exits nonzero when either arm misses a requested fact, mishandles an unknown, or fails to complete.

Evidence coverage binds a value to its entity in message content. It does not count matching numbers in timestamps, token usage, question IDs, or line-number prefixes. Generated assistant text is also excluded from this coverage check. Archive preservation checks the complete original fact statement. These checks prevent common scalar-value coincidences from being reported as retrieval; content-line co-occurrence is still a text heuristic.

This is a sampled synthetic evaluation, not exhaustive hosted retrieval of all 1,000 facts. Manual compaction does not measure automatic trigger timing, and rolling masking is disabled to isolate checkpoint recovery. SDK cost estimates do not establish subscription billing.

## Baseline before per-query candidate reservation

The verified three-seed run used `openai-codex/gpt-6-astra-fast` with `high` reasoning and `openrouter/typesafe/jev-1.14` for compaction. Each compaction archived all 1,000 facts and removed 970 or 971 from retained context. Each arm answered 72 sampled fact questions and 18 unanswerable questions.

| Arm                  | Exact facts | Unknowns | Stale answers |
|----------------------|------------:|---------:|--------------:|
| Recall + prefetch    |       72/72 |    18/18 |             0 |
| Explicit recall only |       65/72 |    18/18 |             1 |

The other six explicit-only misses were `null` answers. None of the seven missed current values appeared in that batch's model inputs. All explicit-only batches started with zero sampled answers in context. All combined batches received their eight current answers through prefetch. No tool reads were blocked, no final turns were forced, and live settings remained unchanged.

That baseline exposed an explicit-recall retrieval gap even though prefetch supplied every sampled answer. It did not establish perfect recall on arbitrary real histories.

Verified report: `/private/var/folders/2p/9hk4b2yx0wdckt43n_4g2wbc0000gn/T/context-compacted-facts-7YCybs/report.json`. Earlier runs with missing profile/fast-tier wiring or a noncanonical temporary root are not the reported cohort.

## Per-query candidate reservation

A minimal reproduction with seven or eight identifier-only queries lost one or two answers before classification. The selector reserved only six of its 12 text-candidate slots for lexical matches, then filled the rest with unrelated semantic candidates. This reproduced the shape of the agent's failing batches.

The selector now reserves each query's best lexical passage before filling spare slots. Existing recency tie-breaking favors the newer revision when scores match. Shared evidence is deduplicated, the 12-candidate cap remains, and unrelated candidates can still support semantic matches.

A fresh three-seed run and one held-out seed used the same answering model, reasoning level, and compaction classifier:

| Cohort                  | Recall + prefetch | Explicit recall | Unknowns per arm | Stale answers |
|-------------------------|------------------:|----------------:|-----------------:|--------------:|
| Three original seeds    |             72/72 |           72/72 |            18/18 |             0 |
| One fresh held-out seed |             24/24 |           24/24 |              6/6 |             0 |

Both arms passed all 96 sampled fact questions, including eight revised-value questions, and all 24 unknown checks. All four histories used real classifier compaction and retained every original fact in their archives. Neither run needed a forced final turn or reported classifier failures. Live settings remained unchanged.

These are fresh compactions, not paired trials with frozen checkpoints. Compaction can change which facts remain visible, so the eligible question sets can differ from the baseline. The result supports the candidate-selection fix on this synthetic workload; it does not cover diverse fact schemas, long-artifact tails, or repeated automatic compaction.

Reports:

- Three-seed run: `/private/var/folders/2p/9hk4b2yx0wdckt43n_4g2wbc0000gn/T/context-compacted-facts-woq1aO/report.json`
- Held-out run: `/private/var/folders/2p/9hk4b2yx0wdckt43n_4g2wbc0000gn/T/context-compacted-facts-uYFSEl/report.json`

## Diversified 500-question cohort

The larger cohort used five previously unused seeds, `diverse-scale-1` through `diverse-scale-5`. Each history contained 1,000 current facts plus 200 superseded values. The sampler selected 100 hidden facts per seed, giving 500 known-answer trials per arm. Each arm also received 130 unknown checks.

The run used the same `openai-codex/gpt-6-astra-fast` answering model with `high` reasoning and `openrouter/typesafe/jev-1.14` for compaction. Two isolated evaluator processes ran concurrently, one for seeds 1 and 2 and another for seeds 3 through 5. Arm ordering remained counterbalanced. The pilot seed was excluded from the reported cohort.

| Fact type   | Recall + prefetch | Explicit recall |
|-------------|------------------:|----------------:|
| Identifier  |           100/100 |         100/100 |
| Number      |           100/100 |         100/100 |
| Path        |           100/100 |         100/100 |
| Date        |            99/100 |         100/100 |
| Danish text |           100/100 |         100/100 |
| Total       |           499/500 |         500/500 |

Both arms passed all 250 paraphrased questions and all 130 unknown checks. The combined arm passed 249/250 direct questions and 99/100 revised-value questions. Explicit recall passed all direct and revised-value questions.

The single failure was `diverse-scale-5`, combined batch 0, `fact_153`. The latest approved `expiry_date` for `svcafxq` was `2032-10-29`; the agent returned the superseded `2035-08-04`. Prefetch supplied only the old date for that entity. The current date never appeared in any of the three answering-model requests, and the agent did not explicitly search that entity. This was not a blocked read or a forced final turn. The explicit-only arm answered the same question correctly.

Prefetch supplied 350 of the 500 current answers. The agent used explicit recall to fill most remaining gaps. Two other combined batches reached the model-request cap and received a forced final turn; both answered correctly. No classifier failures or blocked tool calls were recorded. All 65 explicit-only batches began without their sampled answers in context. All five compactions archived every current fact, left 970 current facts outside retained context, and preserved live settings.

The combined arm failed the strict zero-error quality gate. The failure remains in that report; no retry replaced it. It motivated the revision-context change below.

These results cover varied synthetic tool-output facts, not arbitrary real histories. Every question names its entity. The cohort does not cover cross-fact reasoning, images, long-artifact tails, or repeated automatic compaction. The unknown checks reuse two question patterns, so their count should not be treated as 130 distinct kinds of missing information.

Combined summary: `/private/var/folders/2p/9hk4b2yx0wdckt43n_4g2wbc0000gn/T/context-compacted-facts-B7z8TJ/cohort-summary.json`.

Source reports:

- Seeds 1 and 2: `/private/var/folders/2p/9hk4b2yx0wdckt43n_4g2wbc0000gn/T/context-compacted-facts-B7z8TJ/report.json`
- Seeds 3 through 5: `/private/var/folders/2p/9hk4b2yx0wdckt43n_4g2wbc0000gn/T/context-compacted-facts-Oqf7pA/report.json`

## Restoring revision context

The failing classifier request contained both expiry dates, but neither excerpt included the archive's revision header. The current value was not missing from candidate selection. The classifier chose the older value without seeing `Service audit revision 2, superseding revision 1.`

Recall now carries a bounded source prefix alongside the matching excerpt. Both explicit recall and prefetch classifiers receive it, and returned passages retain its citations under `Source context (same archive)`. The existing candidate ranking and classifier criteria were unchanged. Older snapshots are not deleted or filtered out by a rule that assumes the largest date or latest read is authoritative.

The focused `context-prefetch-revisions.ts` evaluator uses the real production prefetch hook and configured hosted classifier. It reconstructs the recorded batch from the synthetic corpus, then isolates the two snapshots. It does not run compaction or an answering agent.

```sh
bun run --cwd .pi/agent benchmarks/context-prefetch-revisions.ts --run --repeats=20
```

The baseline used ten repeats per fixed scenario. The final check used twenty repeats per scenario with `openrouter/typesafe/jev-1.14`:

| Scenario                        | Correct-only baseline | Correct-only after |
|---------------------------------|----------------------:|-------------------:|
| Recorded batch, latest value    |                  0/10 |              20/20 |
| Two snapshots, latest value     |                  0/10 |              20/20 |
| Explicit request for revision 1 |                  1/10 |              20/20 |
| Old revision read after new     |                  0/10 |              20/20 |

The final 80 classifier calls returned no wrong revision and did not abstain. These are repeats of four fixed cases, not 80 independent facts. The recorded batch's captured classifier input grew from 8,338 to 10,216 bytes.

A separate end-to-end run used real compaction and the answering agent on `diverse-scale-5` and the fresh `diverse-revision-holdout-1` seed, with 100 sampled facts per history:

| Mode              | Exact facts | Unknown checks | Revised facts | Stale answers |
|-------------------|------------:|---------------:|--------------:|--------------:|
| Recall + prefetch |     200/200 |          52/52 |         40/40 |             0 |
| Explicit recall   |     200/200 |          52/52 |         40/40 |             0 |

In the formerly failing `fact_153` case, prefetch supplied the revision-2 header and `2032-10-29` before the first answering-model request. The agent returned that value. Review of all 52 traces found no blocked tool calls, no initial answer leakage in the 26 explicit-only batches, and no stale-only or mixed old/current prefetch for the revised probes. No classifier failures or forced final turns were recorded; live settings remained unchanged.

The historical and reversed-read-order checks exercise the classifier. The end-to-end cohort still asks for current values. This restores near-start revision evidence, not universal revision tracking: the prefix is limited to three normalized segments and 320 characters, and the existing 128 KiB per-file read limit remains. Headers elsewhere and repeated automatic compaction need separate coverage.

Reports:

- Focused baseline: `/private/var/folders/2p/9hk4b2yx0wdckt43n_4g2wbc0000gn/T/prefetch-revisions-BJka3J/report.json`
- Final focused check: `/private/var/folders/2p/9hk4b2yx0wdckt43n_4g2wbc0000gn/T/prefetch-revisions-BrmPWn/report.json`
- End-to-end run: `/private/var/folders/2p/9hk4b2yx0wdckt43n_4g2wbc0000gn/T/context-compacted-facts-3q5mjF/report.json`
