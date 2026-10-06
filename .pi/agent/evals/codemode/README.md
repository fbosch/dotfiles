# Codemode batching eval

Seven Caliper cases compare current codemode guidance with the reviewed rule in
`candidate.md`. The production instruction is not changed by the runner.

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

The runner uses one worker and a configured model preset. Each attempt gets
an isolated HOME, fixture files, and the same tool definitions. Only the rule
changes between arms. `baseline.md` freezes the original AGENTS.md rule so
relocating production instructions cannot change the control arm. The candidate
matches `.pi/agent/instructions/codemode.md`; a regression test checks equality
and conditional loading. This is not a full personal-extension-stack eval.

Require all 21 candidate attempts to pass before adopting the rule. Report
infrastructure errors separately. Caliper returning exit code zero does not
mean every task passed; inspect the per-attempt outcomes and verdicts.

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
