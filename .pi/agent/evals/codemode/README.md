# Codemode batching eval

Thirteen Caliper cases compare codemode instruction snapshots, including
session-derived batching failures and a large read-and-edit workflow. The runner
does not change production instructions.

## Accepted profile

The promoted guidance passed 39/39 attempts on
`openai-codex/gpt-6-luna-fast:high` with precise fixture output schemas.
The matching original-guidance control passed 29/39. All 13 cases passed
three attempts each, with no unusable attempts or timeouts.

The production fragment and `candidate.md` match the frozen passing snapshot.
The rule requires a short execution plan, distinguishes separate invocations
from direct-tool requests, and preserves raw source values through parsing and
reporting. `routing-reminder-baseline.md` freezes the failed first revision
that preceded promotion.

This gate pass applies only to the recorded high-effort, precise-schema
profile. The final guidance has not cleared the low-effort gate or a full
personal-extension-stack eval. Production model and thinking settings did not
change. These were exploratory, sequential trials, not held-out confirmation.

- Control: `.caliper/results/codemode/2026-10-31T13-28-13Z.json`
- Passing candidate: `.caliper/results/codemode/2026-10-31T13-56-37Z.json`
- Frozen evidence: `.caliper/codemode/run.4Qv7ZU`
- Measurement: `.caliper/codemode/guidance-iteration/promoted-measurement.json`

Caliper reported 11% more tokens and no rounded change in summed attempt
execution time at the same reasoning level.

Use a Pi entry point compatible with the runner's isolated HOME. The recorded
runs used the temporary launcher described below. To repeat the matched profile:

1. Run the original-guidance control.

   ```sh
   CODEMODE_EVAL_TYPED_OUTPUTS=1 \
   CODEMODE_EVAL_CANDIDATE="$PWD/.pi/agent/evals/codemode/session-baseline.md" \
     scripts/caliper-skill-eval.sh --codemode codemode openai-codex/gpt-6-luna-fast high 3
   ```

2. Run the promoted candidate.

   ```sh
   CODEMODE_EVAL_TYPED_OUTPUTS=1 \
     scripts/caliper-skill-eval.sh --codemode codemode openai-codex/gpt-6-luna-fast high 3
   ```

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

### First revision comparison (superseded)

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

### Further routing experiments

Six further candidates used the same prompts, grader, fixture, model, and
thinking level. Two smoke runs passed 7/13 and 12/13. Four full runs passed
35/39, 36/39, 35/39, and 29/39. No candidate met the 39/39 gate.

`routing-candidate.md` preserves the best observed candidate, which passed
36/39 in result `.caliper/results/codemode/2026-10-31T12-03-35Z.json`.
It distinguishes tool invocations from answer formatting, requires inspecting
actual JSON shapes, and specifies bounded output with source attribution.
Two attempts still used direct reads instead of batching; one generated invalid
JavaScript before recovering. All three session-derived cases passed 3/3.

This candidate is not loaded in production. Its 36/39 score is an exploratory
result selected from several variants, not a held-out confirmation of improvement.
All trial hashes, outcomes, and failure paths are recorded in
`.caliper/codemode/guidance-iteration/measurement.json`.

### Instruction delivery and tool metadata

The guidance reached the actual provider request. This runtime declares tools
through `input` items of type `additional_tools`, not only `payload.tools`.
The probe now reads both forms. Prompt tracing records system instructions
and tool descriptions only, not request headers or user messages.

Three eval-only flags are frozen in each run's metadata and disabled by default:

- `CODEMODE_TRACE_PROMPT=1` captures instruction delivery and tool descriptions.
- `CODEMODE_EVAL_TOOL_ROUTING=1` prepends advisory routing to tool descriptions.
  It does not block, execute, or reroute calls. Its smoke run passed 10/13 and
  was not promoted.
- `CODEMODE_EVAL_TYPED_OUTPUTS=1` replaces `unknown` output declarations with
  precise schemas for the fixture's existing read and check results. Returned
  data, task prompts, and grader requirements remain unchanged. Offline tests
  verify all 13 execution contracts in both schema modes.

Requiring a short execution plan fixed required-call batching in all 24
independent-call attempts of a 35/39 full run. Task failures remained in JSON
parsing and reporting. A raw-source decoding example did not clear its next
probe either.

`planned-candidate.md` preserves the next candidate. With precise output
schemas, the original guidance passed 30/39 and this candidate passed 37/39.
Both arms used the same model, thinking, fixture, grader, and declared schemas.
Do not compare 37/39 directly with the earlier 29/39 control, which declared
outputs as `unknown`. The two remaining failures were a script error and a
mutation that parsed anchor-prefixed display text as JSON.

- Matching control: `.caliper/results/codemode/2026-10-31T12-50-03Z.json`
- Candidate: `.caliper/results/codemode/2026-10-31T12-55-32Z.json`
- Measurements: `.caliper/codemode/guidance-iteration/delivery-and-routing-measurement.json`

At this stage neither schema mode had passed the 39/39 gate. The later
high-effort validation in Accepted profile supersedes this outcome. Production
model and thinking settings remain unchanged. Selecting a candidate across
exploratory trials is not held-out confirmation.

The first high-effort planned candidate passed 37/39 against a 29/39 control.
Clarifying "separate tool calls" fixed that case in the next run, but the run
had one reporting failure and one 120-second timeout after the script had
succeeded. The timeout remains counted as unusable, not as a pass. Adding an
explicit constants-and-values check produced the later 39/39 gate pass.

The earlier high-effort results and failure traces remain in
`.caliper/codemode/guidance-iteration/high-reasoning-measurement.json`.

The root TypeScript config does not include eval files. Use the scoped
`evals/codemode/tsconfig.json` to check this code against the installed SDK:

```sh
devenv test --no-tui --option enterTest:string 'cd .pi/agent && node_modules/.bin/tsc --noEmit --noUnusedLocals --noUnusedParameters --project evals/codemode/tsconfig.json && bun test evals/codemode && node_modules/.bin/biome check evals/codemode'
```

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
