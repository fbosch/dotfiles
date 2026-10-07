# Input-only skill suggestion ablation

Input-only suggestions are the cheaper candidate for the next real-corpus test.
In the matched synthetic comparison, full suggestions gained one successful skill
selection but had fewer passing workflow applications. Input-only used 59.7%
fewer classifier tokens. This is a small, timeout-affected sample, not evidence
that input-only is generally better.

## Setup and availability

The fresh campaign used `openai-codex/gpt-6-luna-fast` at `xhigh`, the corrected
outcome rubric, and the same eight skills and warm/cold settings in both arms.
Only mid-task selection enablement differed. Automatic selection had a 5000 ms
deadline in both arms; search kept its 2400 ms deadline and each task kept its
120-second limit. Production settings were not changed.

Three blocks ran all 12 tasks once per arm. Arm order was input-only then full,
full then input-only, and input-only then full. Recorded source hashes, model,
routing, visibility, threshold, and selection deadlines matched across arms.

All 72 scheduled attempts started. Input-only had 34 usable attempts and two
main-agent timeouts; full suggestions had 33 usable attempts and three timeouts.
There were no classifier-availability failures. Every graded attempt passed the
bounded task-outcome rubric, 34/34 and 33/33. The five ungraded attempts remain
unavailable rather than passes or semantic no-matches.

The raw comparison has unequal usable case counts. To compare quality on the same
cases, the supplemental analysis pairs attempts by block and case and excludes
both sides if either is ungraded or infrastructure-failed. It never excludes a
pair because of an outcome, selection, or application failure. This leaves 31
matched pairs, including 19 positive cases and all 12 status-only negatives.
The matching rule is supplemental, post-run analysis; the original verdicts and
raw comparison remain unchanged.

## Matched results

| Measure | Input-only | Input and mid-task |
| --- | ---: | ---: |
| Task-outcome rubric passes | 31/31 | 31/31 |
| Correct skill selection | 25/31, 80.6% | 26/31, 83.9% |
| Required skill-group recall, positive cases | 13/19, 68.4% | 14/19, 73.7% |
| Selected and applied workflow, positive cases | 11/19, 57.9% | 7/19, 36.8% |
| Unnecessary skill reads | 0 | 0 |
| Recorded main-model tokens | 125,221 | 136,497 |
| Recorded classifier tokens, including search | 68,722 | 170,370 |
| Summed execution time of matched attempts | 514.4 seconds | 729.6 seconds |

Application checks include exact section labels and evidence-read order. They
measure the fixture's workflow compliance, not a complete semantic assessment.
The joint metric additionally requires successful skill selection. In these
matched cases, the joint and standalone application counts are identical.

Input-only reduced matched classifier token volume by 59.7%, combined recorded
token volume by 36.8%, and summed matched execution time by 29.5%. Token counts are
not billed costs; model and cache pricing differ. Timing excludes the failed
pairs and remains sensitive to provider conditions despite blockwise interleaving.

## Mid-task contribution and total recorded usage

Across all 36 scheduled attempts per arm, including partial timeout traces,
input-only made 36 valid input calls and no mid-task calls. Full suggestions made
36 valid input calls and 60 valid mid-task calls. Search was used five times in
input-only and four times in full suggestions.

The 60 mid-task calls produced three later skill records in three attempts:

- Two recommended `restore-verification` on positive restore tasks. Both skills
  were read; one attempt passed the application rubric and one did not.
- One recommended `record-audit` despite initial advice for the accepted
  alternative `ledger-reconciliation`. The agent read the original recommendation,
  not the extra one.

Neither dedicated mid-task scenario received later advice. The observed later
recommendations therefore do not establish successful discovery of newly revealed
workflows in this suite.

Recorded classifier tokens across all traces were 80,238 for input-only and
202,631 for full suggestions, a 60.4% reduction. Combined recorded main-model and
classifier tokens were 229,074 and 365,966. Partial timeout traces contribute
observed usage, but missing responses can leave spend incomplete. The raw
comparator's `*AllGraded` fields omit those ungraded traces; do not confuse those
fields with the all-trace totals above.

## Interrupted 2400 ms campaign

The earlier input-only campaign started 48 attempts before being abandoned. Two
full-suggestions attempts lacked a valid input classifier response. One entire
12-attempt block was retried once; a later block hit the same availability problem.
The valid first pair of blocks had 12 attempts per arm, equal 83.3% selection, and
about 60% fewer classifier tokens for input-only. Those partial observations are
not pooled with the fresh 5000 ms campaign.

Increasing the deadline coincided with no classifier-availability failures in the
new campaign, but it was not a controlled deadline comparison. It did not prevent
main-agent timeouts. Keep availability separate from conditional quality.

## Evidence and replay

All raw evidence is local and ignored by Git:

- Fresh campaign: `.caliper/skill-suggestions/ablation-long.WP1rKh`
- Raw comparison: `comparison.json` inside that campaign
- Matched analysis and all-trace usage: `supplemental.json`
- Replayable supplemental calculation: `analyze.py`
- Initial and continued drivers: `driver.sh` and `resume-driver.sh`
- Interrupted campaign: `.caliper/skill-suggestions/ablation.Kj1UPR`

```sh
python3 .pi/agent/evals/skill-suggestions/compare.py \
  .caliper/skill-suggestions/ablation-long.WP1rKh/input-only \
  .caliper/skill-suggestions/ablation-long.WP1rKh/treatment
python3 .caliper/skill-suggestions/ablation-long.WP1rKh/analyze.py
```

Retain the source-run directories listed in each campaign's `.sources` files to
replay the supplemental analysis. Cleaning ignored evidence removes replay data.
Neither replay command makes model calls or changes grading.

## Implementation and next decision

`classifier.skillSelection.midTaskEnabled` now permits independent opt-out while
retaining input recommendations and search. It defaults to true. The eval wrapper
accepts `--input-only` and `--selection-timeout-ms`; deadlines are bounded to 5000
ms and recorded to prevent mixed-deadline comparisons. The production default and
repository setting remain 2400 ms.

Validation passed 81 skill-discovery tests, 17 eval tests, and six wrapper tests
through `devenv test`, plus scoped Biome, shellcheck, and `git diff --check`.
The installed-Pi test exercises full suggestions, terminating turns, and
input-only mode without forcing extra model turns.

Full TypeScript checking remains blocked by 11 errors outside this scope, in
`prompt-ui` and `pi-hashline-edit-pro`. No errors remain in skill-discovery or
skill-suggestion eval files.

Do not treat this as a reason to deploy a longer deadline. Test input-only against
representative tasks using the actual skill corpus next. Before retaining
mid-task checks, replace the tool-outcome-only trigger with a gate that requires
informative new visible evidence. Hold request compression and candidate
shortlisting as separate changes so their effects remain measurable.
