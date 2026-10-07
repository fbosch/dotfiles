# Skill suggestion A/B results

Automatic suggestions improved skill discovery and workflow compliance in this
synthetic comparison, but added substantial classifier token volume. The run does
not establish better task correctness or generalize to the personal skill corpus.

## Full run, 2026-10-07

The run used `openai-codex/gpt-6-luna-fast` at `xhigh`, 12 tasks with three
repetitions per arm, eight synthetic skills, and identical tool and warm/cold
settings. All 72 attempts were graded and usable, with no infrastructure errors.
Source hashes and configuration matched across arms.

| Measure | Search only | Automatic suggestions |
| --- | ---: | ---: |
| Correct skill selection, all attempts | 26/36, 72.2% | 32/36, 88.9% |
| Required skill-group recall, positive tasks | 14/24, 58.3% | 20/24, 83.3% |
| Workflow application, positive tasks | 12/24, 50.0% | 16/24, 66.7% |
| Unnecessary skill reads | 0 | 0 |
| Original task-outcome rubric passes | 32/36 | 33/36 |
| Main-model tokens | 136,655 | 156,179 |
| Classifier tokens, including search | 8,211 | 197,035 |
| Summed attempt execution time | 483.2 seconds | 597.3 seconds |

Treatment gained six successful selections and four workflow applications.
Positive handoff selection rose from 0/3 to 3/3; positive restore selection rose
from 2/3 to 3/3. Mid-task restore selection rose from 0/3 to 2/3, with application
in one attempt. Neither arm read the handoff skill in its mid-task case, 0/3 each.
All 12 status-only negative attempts per arm avoided unnecessary skill reads.

Treatment made 36 input and 55 mid-task automatic classifier calls; all 91
returned valid responses. Baseline made no automatic calls. Search remained
available and was used seven times in baseline and eight times in treatment.

Main-model token volume rose 14.3%. Combined recorded main-model and classifier
tokens rose from 144,866 to 353,214, about 2.44×. These are token counts, not billed
costs: the models and cache pricing differ. Classifier elapsed time rose from
3.7 to 47.9 seconds; total attempt execution time rose 23.6%. Serial arm order and
provider conditions limit the timing comparison.

## Outcome-grading defect

The original rubric required the exact substring `validate receipt`. Every raw
outcome failure, four in baseline and three in treatment, instead used the correct
paraphrase `validate the receipt` or `receipt validation`. Trace review confirmed
that these seven attempts met the other outcome patterns, the required progress
sequence where applicable, and the tool constraints. The original 32/36 versus
33/36 scoreboard therefore does not demonstrate a task-correctness gain.

After both arms completed, the source rubric was corrected to accept those
paraphrases, with a regression test that still rejects an unrelated validation
action. Original expected records, verdicts, and the comparison were not changed
or rescored. Future runs use the corrected rubric. Skill selection and application
metrics above are unaffected.

## Evidence and replay

Ignored local evidence:

- Baseline: `.caliper/skill-suggestions/run.mYDvEH`
- Treatment: `.caliper/skill-suggestions/run.yCfJev`
- Raw comparison: `.caliper/skill-suggestions/comparison-full.json`

```sh
python3 .pi/agent/evals/skill-suggestions/compare.py \
  .caliper/skill-suggestions/run.mYDvEH \
  .caliper/skill-suggestions/run.yCfJev
```

This command compares the preserved verdicts; it does not regrade them with the
updated source rubric. The results are documented here, but raw evidence is ignored
and must be retained separately for replay after moving or cleaning the worktree.

The earlier three-task pilot had equal outcomes and no skill-use improvement. Its
evidence was removed during repository cleanup, so it is not included in this
full-run comparison. Interrupted and earlier invalid pilot attempts are excluded.

## Decision

The observed discovery gain is real in this fixture set, especially for cold
skills. The overhead is large enough that this result does not justify automatic
checks on cost savings alone. Before extending the claim to everyday use, test
representative tasks against the actual skill corpus, with a broader outcome
rubric and interleaved arm order. The small synthetic sample and strict formatting
checks limit what this run establishes.

Validation after the rubric correction passed 11 eval tests and six runner tests
through `devenv test`. The eval tests are registered as
`test:skill-suggestions-eval` in `devenv.nix`. Scoped Biome, shellcheck, and
`git diff --check` also passed; no full repository typecheck or test run is claimed.
