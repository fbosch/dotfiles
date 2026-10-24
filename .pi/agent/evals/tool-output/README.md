# Tool-output agent evaluation

This paired evaluation checks whether Bash previews change final agent answers, artifact retrieval, or completion overhead. It runs the production preview extension inside isolated Pi SDK sessions. It does not change active project or agent settings.

## Method

Six fixed synthetic captures cover visible constraints, an identifier without recognized markers, an unmarked contradictory observation, a 1,200-line completeness question, a failed command, and dense diagnostics that must not be shortened. Each task has an exact typed JSON answer. The agent receives the question, not the expected answer.

Each case runs with previews off and on in fresh in-memory sessions, twice by default. Order alternates across cases and repeats. The model and low thinking level remain fixed. There is no classifier judge. Service failures, incomplete pairs, and inactive preview mechanisms are excluded rather than counted as successful comparisons.

The evaluation uses native Bash capture with injected synthetic execution and the native paginated reader. Bash cannot execute real commands, and read access is restricted to artifacts produced by that trial. Personal extensions, skills, context files, and prompts are not loaded. The production preview extension receives isolated off/on settings; normal project-trust checks remain enabled.

The runner records final replies, exact-answer scores, tool calls, read ranges, preview reports, provider-reported usage, estimated costs, and wall time. These files contain synthetic output only. Trial directories are private. No credential values are logged. Agent settings are hashed before and after the run to check that they remain unchanged.

## Reproduce

1. Synchronize against the installed Pi SDK:

   ```sh
   cd ~/dotfiles/.pi/agent
   bun run sdk:sync
   ```

2. Run the local checks:

   ```sh
   bun test evals/tool-output
   bunx --no-install tsc --noEmit -p evals/tool-output/tsconfig.json
   ```

   Repository validation runs these tests through a scoped `devenv test` invocation.

3. Run the billed or subscription-backed live evaluation with an explicitly selected model:

   ```sh
   EVAL_PROVIDER=openai-codex EVAL_MODEL=gpt-6.1-sol \
     EVAL_REPEATS=2 EVAL_MAX_TRIALS=24 bun evals/tool-output/evaluate.ts
   ```

   To compare read-only artifact retrieval against search, with repetition-only previews enabled in both arms:

   ```sh
   EVAL_COMPARISON=search EVAL_PROVIDER=openai-codex EVAL_MODEL=gpt-6.1-sol \
     EVAL_REPEATS=2 EVAL_MAX_TRIALS=8 bun evals/tool-output/evaluate.ts
   ```
   Without explicit model variables, the runner uses `PI_PROVIDER` and `PI_MODEL`. It stops after two consecutive service failures. Each trial is bounded to 120 seconds, 10 turns, and 20 tool calls. The maximum configurable run is 36 trials and three repeats. The runner prints its private temporary result directory.

## Original marker-only run

The main run used `openai-codex/gpt-6.1-sol`, low thinking, and installed Pi 1.4.0. Raw results are in `/tmp/pi-output-agent-eval-ryH5Xp/`. An earlier two-trial smoke test in `/tmp/pi-output-agent-eval-xvsQPI/` is not included in these totals.

| Metric | Previews off | Previews on |
| --- | ---: | ---: |
| Trials | 12 | 12 |
| Exact answers correct | 12 | 12 |
| Artifact read calls | 0 | 15 |
| Total tool calls | 12 | 29 |
| Median completion time | 4.489 s | 9.722 s |
| Uncached input tokens | 52,808 | 61,832 |
| Cache-read input tokens | 0 | 14,080 |
| Output tokens | 466 | 1,445 |
| Estimated usage cost, USD | 0.110276 | 0.139522 |

All 12 pairs were complete, with no service failures or mechanism exclusions. All six preview-on trials requiring hidden evidence used artifact reads and answered correctly. Failed-command and dense-diagnostic controls remained unshortened. One visible-diagnostic trial also retrieved the entire capture despite having sufficient evidence in its preview.

No answer regression was observed, but efficiency regressed in this sample. Median completion time was 2.17 times the baseline, and estimated usage cost increased by about 27%. Initial output reduction did not translate into lower total input usage because agents retrieved more evidence in additional turns. Cost values are usage estimates, not verified account charges, especially for subscription-backed providers. Timing includes model and network variability; unchanged-output controls also varied, so the difference is not a measurement of the extension's local processing time.

Two preview-on completeness trials tried a shell filtering command before reading the artifact. The isolated executor rejected those commands, adding two recovery calls. A real agent could filter an artifact with grep or Python, so these overhead figures are not a clean estimate for unrestricted shell workflows. They describe this bounded reader-based evaluation.

## Repetition-only revision

A second 24-trial run used the same six captures, questions, exact expected answers, model, thinking level, and alternating off/on design. It evaluated repetition removal before the search tool was added. Raw results are in `/tmp/pi-output-agent-eval-gvZk70/`.

| Metric | Previews off | Repetition-only previews |
| --- | ---: | ---: |
| Exact answers correct | 12/12 | 12/12 |
| Artifact read calls | 0 | 0 |
| Total tool calls | 12 | 12 |
| Median completion time | 4.451 s | 4.966 s |
| Uncached input tokens | 52,808 | 22,529 |
| Output tokens | 466 | 466 |
| Estimated usage cost, USD | 0.110276 | 0.049718 |

All 12 pairs were complete, with no service failures or mechanism exclusions. Every fact needed for these questions remained visible, including the unmarked identifier, contradictory observation, and all adjustment records. Estimated cost fell by about 55%, without retrieval. Median latency was about 12% higher, so this run does not demonstrate a latency improvement. The earlier marker-only preview took 15 reads and a 9.722-second median in its separate run; cross-run timings are not a randomized head-to-head comparison of revisions.

## Current preview and search evaluation

A final 24-trial run included the search tool declaration in the preview-on arm. The preview-off arm had neither compaction nor search available. Captures, questions, exact answers, model, and thinking level were unchanged. Results are in `/tmp/pi-output-agent-eval-w7E9sG/`.

| Metric | Previews off | Current previews with search available |
| --- | ---: | ---: |
| Exact answers correct | 12/12 | 12/12 |
| Artifact read calls | 0 | 0 |
| Artifact search calls | 0 | 0 |
| Total tool calls | 12 | 12 |
| Median completion time | 4.395 s | 4.8525 s |
| Uncached input tokens | 52,832 | 27,830 |
| Output tokens | 466 | 466 |
| Estimated usage cost, USD | 0.110324 | 0.060320 |

All pairs were complete with no exclusions. The revised preview retained the answers without retrieval. Estimated cost was about 45% lower, including the extra tool declaration overhead. Median completion remained about 10% slower in this run; no general latency gain is established.

A separate eight-trial retrieval evaluation used two counter-presence questions and two repeats. Repetition-only previews were enabled in both arms. The read-only arm lacked search; the search arm could issue literal searches over the same capture. These questions require inspecting collapsed counter values, including a missing value inside increasing boundary counters. The question names the counters but does not disclose whether they are present. Results are in `/tmp/pi-output-agent-eval-vaaPaH/`.

| Metric | Read-only retrieval | Search available |
| --- | ---: | ---: |
| Exact answers correct | 4/4 | 4/4 |
| Artifact read calls | 5 | 0 |
| Artifact search calls | 0 | 4 |
| Total tool calls | 11 | 8 |
| Median completion time | 9.3375 s | 7.886 s |
| Uncached input tokens | 14,454 | 11,108 |
| Output tokens | 535 | 403 |
| Estimated usage cost, USD | 0.034258 | 0.026246 |

All four pairs were complete, with no exclusions or service failures. Each search-enabled agent used one batched literal search and answered correctly. Search had about 23% lower estimated cost in this sample. Two rejected grep commands inflated the read-only arm by two recovery calls, so its latency and cost disadvantage cannot be attributed solely to pagination. A real shell can already search artifacts; this experiment tests a bounded tool alternative, not superiority over grep.

Across these two final evaluations, all 32 answers were correct. This does not establish broad absence of regressions: the captures are synthetic, the model and reasoning level are fixed, and the number of independent cases is small. Active settings remained byte-for-byte unchanged during each run.

## Limits and conclusion

These are six synthetic questions with two repeats, one model, low thinking, short initial contexts, and a native numeric-line reader. They do not cover the full personal extension stack, the installed hashline reader's live agent behavior, long coding tasks, file edits, or broad model variability. Separate implementation tests cover installed hashline pagination, but that is not a substitute for agent-quality evaluation with that reader.

The experiments provide regression evidence, not a statistical non-inferiority result or a guarantee that progress counters are irrelevant. The original marker-only selector omitted unmarked facts and required recovery reads. The current selector retains non-progress lines and collapses only recognized repeated progress templates. Exact questions about collapsed events still require retrieval; the search comparison exercises that case.

Keep previews opt-in rather than claiming a general performance improvement. Before broader adoption, evaluate representative coding tasks and selective artifact search under the actual extension stack. The evaluation leaves the active setup unchanged.
