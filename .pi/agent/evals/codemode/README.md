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

The runner uses one worker and the production model preset. Each attempt gets
an isolated HOME, fixture files, and the same tool definitions. Only the rule
changes between arms. The baseline snapshots codemode-related lines from
`.pi/agent/AGENTS.md`, not the full personal instruction and extension stack.

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

The next revision should explicitly require codemode for two or more independent
calls. Keep these cases unchanged when evaluating that revision.
