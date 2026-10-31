# Codemode batching eval

Thirteen Caliper cases compare codemode instruction snapshots, including
session-derived batching failures and a large read-and-edit workflow. The runner
does not change production instructions.

## Run

Use the installed Pi, Caliper, and existing authenticated profile. No new
packages are required. From the repository root:

```sh
# Smoke-test the candidate and harness.
scripts/caliper-skill-eval.sh --codemode codemode configured configured 1

# Compare three attempts per case, with the same configured model and thinking.
scripts/caliper-skill-eval.sh --codemode --baseline codemode configured configured 3
scripts/caliper-skill-eval.sh --codemode codemode configured configured 3

# Use the two result paths printed by those commands.
caliper compare BASELINE_RESULTS.json CANDIDATE_RESULTS.json
```

The runner uses one worker and a model from production catalogs. Each attempt gets
an isolated HOME, fixture files, and the same tool definitions. Only the rule
changes between arms. `baseline.md` freezes the original AGENTS.md rule so
relocating production instructions cannot change the control arm. The candidate
matches `.pi/agent/instructions/codemode.md`; a regression test checks equality
and conditional loading. This is not a full personal-extension-stack eval.

Require all 39 candidate attempts to pass before declaring the rule validated. Report
infrastructure errors separately. Caliper returning exit code zero does not
mean every task passed; inspect the per-attempt outcomes and verdicts.

## Compare session-derived batching guidance

The October 31 session sample showed direct calls for three known reference
paths and for a file search plus two independent content searches. The strict
guidance was present in the inspected startup prompts. These observations
motivate the `references` and `mixed-search` cases; the fixtures use synthetic
content and do not copy private transcripts.

Three controls distinguish separate invocations from explicit execution
constraints. `separate-checks` requires a batch of distinct invocations.
`ordered-checks` requires the first check to finish before the second starts.
`direct-checks` requires direct tools without codemode. Existing prerequisite,
mutation, failure-reporting, output-filtering, and single-read cases remain.

`session-baseline.md` freezes the guidance before this revision. Compare that
snapshot with the candidate, not the older `--baseline` arm:

```sh
CODEMODE_EVAL_CANDIDATE="$PWD/.pi/agent/evals/codemode/session-baseline.md" \
  scripts/caliper-skill-eval.sh --codemode codemode openai-codex/gpt-6-luna-fast low 3
scripts/caliper-skill-eval.sh --codemode codemode openai-codex/gpt-6-luna-fast low 3
```

Keep model and thinking identical across arms. Inspect per-case verdicts and
the recorded hashes before comparing totals. The session sample confounded
model and task type; it did not establish a model-only cause. Offline tests
verify the fixture and grader, not whether a model follows the revised guidance.

Codemode model selection now reads the configured default or an explicit
physical model from production catalogs. It does not load specialist presets,
because this fixture launches no specialists. Thinking can be set explicitly.

### Live comparison

Both arms completed 39 attempts on `openai-codex/gpt-6-luna-fast` at `low`,
using Pi 1.4.0. The fixture, grader, launcher, spec, and routing-extension hashes
matched. The guidance hashes differed.

| Check | Previous guidance | Revised guidance |
| --- | ---: | ---: |
| Full task verdicts | 29/39 | 28/39 |
| Executed independent batches | 20/24 | 19/24 |
| Reference-read task verdicts | 3/3 | 1/3 |
| Mixed-search task verdicts | 3/3 | 2/3 |
| Separate-check task verdicts | 3/3 | 1/3 |

Reference-read batching passed 3/3 in both arms. Two revised-guidance attempts
filtered out the settings before reporting them. The remaining task failures
included direct calls instead of batching, repeated target calls, omitted file
attribution, and codemode use despite a direct-call requirement. Basic
independent and prerequisite-followed-by-independent reads improved from 1/3
to 3/3 each, but this did not produce an overall improvement.

Caliper reports 17% more model tokens and 6% more summed attempt execution time
for the revised guidance. Both runs returned exit code zero despite failed
task verdicts. The 39/39 adoption gate was not met. These runs were sequential,
not interleaved, and three attempts per case do not establish a reliable
difference. The revised guidance remains unvalidated.

The external Pi sandbox launcher rejected inherited credential variables and
then Caliper's isolated HOME. Both completed arms used the same temporary
launcher shim with `--no-sandbox` and removed unused GitHub, Context7, and Exa
credential variables from the subprocess environment. No sandbox profile
changed. The runner retained its normal auth-file isolation and refresh
handling. The earlier preflight failures ran no model attempts.

- Previous result: `.caliper/results/codemode/2026-10-31T11-37-15Z.json`
- Revised result: `.caliper/results/codemode/2026-10-31T11-42-28Z.json`
- Evidence: `.caliper/codemode/run.ncDC0O` and `.caliper/codemode/run.vevqtZ`
- Measurement: `.caliper/codemode/session-guidance-comparison/measurement.json`

## Compare the output contract

`output-contract-baseline.md` preserves the pre-change instruction text captured
before the output-contract edit. Override only the candidate snapshot when
comparing it with the current instructions, without editing production files:

```sh
CODEMODE_EVAL_CANDIDATE="$PWD/.pi/agent/evals/codemode/output-contract-baseline.md" \
  scripts/caliper-skill-eval.sh --codemode codemode configured low 3
scripts/caliper-skill-eval.sh --codemode codemode configured low 3
```

Check instruction hashes, identical fixture/grader hashes, model and thinking
settings, and per-case correctness before comparing output or token totals.
Count `model-output.text` across all top-level results, including direct calls.
Nested result text stays inside the script and must not be counted again.
`assistant.usage` records provider usage for each response. Report failed attempts
separately; lower output from skipped work does not establish an improvement.

The large-edit case reads an 80,000-character configuration payload, edits one
field, consumes a large successful write acknowledgement, and verifies the file
in one script. Its grader rejects leaked intermediates and unrelated changes.
Batch instrumentation uses a local Promise subclass because the native sandbox
freezes the global constructor. Earlier smoke runs with empty batch records did
not establish instruction compliance. Historical seven-case comparisons below
retain their original counts and results.

## Checks and evidence

`codemode.eval.yaml` contains the approved prompts. `fixture.ts` registers safe
fixture tools and Pi's native codemode extension from the installed SDK. No
shell tools, classifier models, image models, or unrelated extensions are
available to the evaluated agent. The model request itself uses normal Pi auth
and the production priority-tier routing extension.

The grader checks actual tool starts and completions, dependencies, partial
failures, output filtering, source anchors, and final file contents. A bounded
fixture rendezvous detects overlapping calls by event order, not elapsed time.
In the isolated sandbox only, an instrumentation prefix records completed
`Promise.allSettled()` invocations through codemode's store. A dead-code mention
or `Promise.all()` does not satisfy that check. Both arms use this instrumentation.

Evidence is retained in ignored `.caliper/codemode/run.*` directories. Each run
records instruction snapshots, model settings, fixture/grader hashes, tool
traces, artifact snapshots, and per-attempt verdicts. Caliper result JSON files
are under ignored `.caliper/results/codemode/`.

Offline checks:

```sh
devenv test --no-tui --option enterTest:string \
  'python3 -m unittest discover -s tests -p caliper_codemode_eval_test.py && python3 -m unittest discover -s tests -p caliper_skill_eval_test.py && cd .pi/agent && bun test evals/codemode && node_modules/.bin/biome check evals/codemode'
```

## Recorded comparison

The 2026-10-06 comparison used `openai-codex/gpt-6-luna-fast` at `xhigh`.
Baseline passed 6/21 attempts; candidate passed 7/21. Both had zero unusable
attempts and zero retries. The candidate failed the adoption gate.

The unchanged controls passed 3/3 in each arm: ordered mutations and one direct
read. Among the 15 batching attempts, baseline passed 0/15 and candidate passed
1/15. Most failures were direct tool calls instead of a codemode script, not
proof that the calls ran sequentially. One candidate script batched correctly
but printed bulk output.

Trace evidence confirmed the selected rule was loaded and codemode was declared
to the model. This is an instruction-compliance result, not a speed benchmark.
The extra candidate pass does not establish a reliable improvement.

- Baseline result: `.caliper/results/codemode/2026-10-06T12-26-08Z.json`
- Candidate result: `.caliper/results/codemode/2026-10-06T12-29-51Z.json`
- Baseline evidence: `.caliper/codemode/run.OKq9s5`
- Candidate evidence: `.caliper/codemode/run.VYm8oN`

## Compact guidance comparison

The shortened fragment retains one explicit batching requirement, ordering,
error inspection, filtered source/anchor output, and the direct-call exception.
Its body is 100 words instead of 411. The native tool still supplies sandbox
mechanics and API documentation. The seven prompts and grader are unchanged.

All runs below used `openai-codex/gpt-6-luna-fast` at `low`, with 21 usable
attempts, zero unusable attempts, and zero retries. Time is summed attempt
execution time, not the runner's end-to-end duration.

| Guidance | Passes | Tokens | Time |
| --- | ---: | ---: | ---: |
| Long rule | 21/21 | 82,465 | 125.4s |
| Long confirmation | 21/21 | 82,129 | 142.8s |
| Compact rule | 21/21 | 56,682 | 128.9s |
| Compact confirmation | 20/21 | 54,930 | 133.9s |

The compact confirmation used codemode for one trivial read. All 30 batching
attempts across the two compact runs passed. This is not equivalent to two
clean 21/21 runs. Tokens fell about 32% relative to the long-rule runs; elapsed
time did not establish a speed improvement. These runs were not interleaved,
so provider conditions may affect timing.

Removing the explicit routing requirement scored 2/7 in the smoke run.
Restoring it scored 6/7, with a failure caused by reporting numbered checks
instead of exact tool names. Making source attribution explicit produced the
compact results above. Further wording changes scored 19/21 and 18/21, so the
retained fragment is the tested 100-word revision, not those later variants.
The failed cases were not removed or regraded.

Result files under `.caliper/results/codemode/`:

- Long runs: `2026-10-06T13-16-15Z.json` and `2026-10-06T13-18-49Z.json`.
- Compact runs: `2026-10-06T15-28-01Z.json` and `2026-10-06T15-30-50Z.json`.
- Later wording experiments: `2026-10-06T15-33-41Z.json` and `2026-10-06T15-36-54Z.json`.

Compact trace evidence is in `.caliper/codemode/run.qO1GiE` and
`.caliper/codemode/run.GwIrSY`. The runs record the same fixture/grader hashes
as the long-rule comparison. Earlier interrupted smoke/control runs in
`run.0cYAfV` and `run.4NfsEL` were incomplete and are excluded from comparisons.

## Output-contract retry

The 2026-10-07 retry used `openai-codex/gpt-6-luna-fast` at `low`, with three
attempts per case. Each comparison verified matching model, thinking level,
fixture, grader, launcher, and spec hashes. These were isolated fixture runs.

| Scope | Before passes | After passes | Before model tokens | After model tokens |
| --- | ---: | ---: | ---: | ---: |
| Eight-case suite | 18/24 | 20/24 | 100,608 | 72,625 |
| Clarified large-edit case | 1/3 | 3/3 | 7,244 | 9,016 |

Tokens include input, output, and cache reads across all attempts, not peak
context. Full-suite model-visible tool output fell from 204,266 to 4,033
characters, mostly by avoiding two bulk dumps in failed baseline attempts.
Both arms failed the original large-edit prompt because they parsed rendered
anchor-prefixed text as raw JSON. Those failures remain recorded.

The targeted rerun clarified the read and write encodings identically for both
arms. All six edits preserved the unrelated data and completed read-back
verification. Two baseline answers omitted the path and failed reporting checks.
Both versions already hid the large intermediate results. Tool output was
321 characters before and 407 after; model tokens increased 24.5%. This does
not establish cheaper successful read-and-edit execution.

The sample is small and the arms were not interleaved. The 24/24 adoption gate
was not met. Full evidence and per-attempt outcomes are in
`.caliper/codemode/output-contract-retry/measurement.json`; the baseline and
current instruction snapshots are retained with each run.
