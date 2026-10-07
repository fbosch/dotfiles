# Skill suggestion A/B eval

This eval compares actual agent behavior with automatic skill recommendations off,
at input only, or at input and mid-task checkpoints. All arms retain the same
warm/cold skill catalog, `skill_search`, model, thinking level, fixture tools, and
task files. Baseline disables `classifier.skillSelection.enabled`; input-only
keeps it enabled and disables `classifier.skillSelection.midTaskEnabled`.
Treatment keeps both enabled. The production selector uses threshold 0.72 and its
normal attempt limits. Search uses the real classifier in every arm, with the
production lexical fallback.

The [full-run report](RESULTS.md) records the 72-attempt comparison and its grading
limitation. Raw evidence is ignored; retain it separately for replay.

The [input-only ablation](INPUT-ONLY-RESULTS.md) compares input-only and full
suggestions at a shared 5000 ms deadline, including task timeouts and matched-pair
analysis.

## Run

Use the existing authenticated profile through the repository wrapper. These
commands make hosted agent and classifier calls; they are not startup checks.

```sh
# Pilot: three tasks, one attempt per arm.
scripts/caliper-skill-eval.sh --skill-suggestions --baseline \
  --spec .pi/agent/evals/skill-suggestions/pilot.eval.yaml \
  skill-suggestions configured configured 1
scripts/caliper-skill-eval.sh --skill-suggestions \
  --spec .pi/agent/evals/skill-suggestions/pilot.eval.yaml \
  skill-suggestions configured configured 1

# Full comparison: 12 tasks × 3 attempts × 2 arms = 72 attempts.
scripts/caliper-skill-eval.sh --skill-suggestions --baseline \
  skill-suggestions configured configured 3
scripts/caliper-skill-eval.sh --skill-suggestions \
  skill-suggestions configured configured 3

# Input-only ablation against full suggestions, 36 attempts per arm.
scripts/caliper-skill-eval.sh --skill-suggestions --input-only \
  skill-suggestions configured configured 3
scripts/caliper-skill-eval.sh --skill-suggestions \
  skill-suggestions configured configured 3

# Use the printed evidence directories, baseline or input-only first.
python3 .pi/agent/evals/skill-suggestions/compare.py CONTROL_DIR TREATMENT_DIR
```

`--selection-timeout-ms MS` overrides the automatic input and mid-task deadline
for this eval only, from 1 to 5000 ms. The default remains 2400 ms and search keeps
its 2400 ms deadline. Use the same value in both arms. For example, add
`--selection-timeout-ms 5000` to both input-only and full-suggestions commands.
The deadline is recorded in metadata; aggregation and comparison reject mixed
values. Earlier persisted records without this field used 2400 ms.

For blockwise interleaving, run each arm with `K=1` three times, reversing arm
order in the middle block. Pool each arm's evidence without changing verdicts:

```sh
python3 .pi/agent/evals/skill-suggestions/compare.py --aggregate INPUT_ONLY_COMBINED \
  INPUT_ONLY_BLOCK_1 INPUT_ONLY_BLOCK_2 INPUT_ONLY_BLOCK_3
python3 .pi/agent/evals/skill-suggestions/compare.py --aggregate FULL_COMBINED \
  FULL_BLOCK_1 FULL_BLOCK_2 FULL_BLOCK_3
python3 .pi/agent/evals/skill-suggestions/compare.py INPUT_ONLY_COMBINED FULL_COMBINED
```

Aggregation requires matching source hashes and settings within each arm, rejects
duplicate attempt artifacts, and preserves missing or ungraded evidence. Use new
destination directories. The comparison labels its control arm explicitly.

Each attempt has a fresh HOME and session. The launcher loads only the production
skill-discovery extension, model routing, and bounded fixture instrumentation.
No personal instructions, unrelated extensions, or host skill files enter the
attempt. Credentials are copied through the existing protected wrapper and never
written to evidence. The agent can only read workspace files and installed skill
instructions, search skills, or record progress. It cannot read the grader or
expected answers. The wrapper runs serially with a 120-second attempt deadline
and Caliper's infrastructure fail-fast setting.

## What is measured

Eight frozen synthetic skills cover ledger reconciliation, release scheduling,
restore verification, and handoffs, with competing or nearby workflows. Four are
warm and four are cold. The 12 tasks include positive matches, status-only
negatives, and two tasks whose status cards reveal a new workflow mid-task.
Ledger reconciliation accepts either of two equivalent skills.

The grader reports these independently:

- Task outcome, based on recorded final-answer facts and unchanged task files.
- Skill selection, based on successful instruction-file reads, accepted
  alternatives, missed required groups, and unnecessary reads.
- Workflow application, based on evidence-read order and the skill's required
  output structure. Correct facts without a skill read can still pass the task.
- Main-model tokens, classifier tokens, classifier calls and elapsed time, search
  calls, and total attempt execution time.

Classifier instrumentation records response validity and usage without prompts,
request headers, credentials, or raw responses. An unavailable input classifier
in treatment is a separate infrastructure error, not a semantic no-match.
Caliper's assertion scoreboard can label such an error as a task failure;
`compare.py` separates these attempts and reports missing/ungraded evidence too.
Classifier usage is separate from main-model usage. Sum both for the measured
model-token total; missing usage and ungraded attempts can leave spend incomplete.

Evidence and source hashes live in ignored `.caliper/skill-suggestions/run.*`
directories; Caliper result files live in `.caliper/results/`. The comparator
rejects different model settings, routing, skill visibility, or measured source
hashes, and flags unequal usable case counts. Do not edit measured source files
while a run is in progress.

## Interpretation limits

This tests synthetic workflow discovery and compliance, not the reliability of
the personal skill corpus or the full extension stack. The deterministic text
checks are bounded rubrics, not a complete semantic judge. Application scores
include formatting and read-order compliance, not just task correctness.
The mid-task tasks exercise the production gate but do not force a recommendation;
no suggestion after a revealed workflow is a valid observation.

The default commands run baseline then treatment rather than interleaving, so
provider conditions can affect timing. Three repetitions per task are a pilot-scale
measurement, not proof of a general accuracy gain. Report task outcomes, selection,
unnecessary reads, application, and overhead together. Keep failed cases in the
report and do not change the rubric after seeing full-run results.

## Offline checks

```sh
devenv test --no-tui -O enterTest:string \
  'python3 -m unittest discover -s .pi/agent/evals/skill-suggestions/__tests__ -p test_eval.py && python3 -m unittest discover -s tests -p caliper_skill_eval_test.py && cd .pi/agent && node_modules/.bin/biome check evals/skill-suggestions/fixture.ts'
```
