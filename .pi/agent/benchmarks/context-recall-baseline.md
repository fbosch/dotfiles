# Context footprint recall baseline

Capture recall behavior before changing context-masking rendering. The runner
uses existing recall functions and leaves production extension sources unchanged.
Recorded sessions stay local. Hosted requests contain synthetic fixtures only.

## Recorded results

The pre-change run produced:

| Check | Result |
| --- | --- |
| Synthetic lexical retrieval, top three | 16/16 |
| Synthetic lexical retrieval, first result | 15/16 |
| Hosted classifier retrieval, three repeats | 48/48 |
| Hosted abstention on unanswerable queries | 18/27 |
| Hosted stale-only results | 0 |
| Agent answers, three repeats per retrieval mode | 42/42 |
| Selected older recorded facts, top three | 0/7 |
| Selected older recorded facts, batched retrieval | 0/7 |
| Direct validation of the seven recorded sources | 7/7 |

The agent used `vercel-ai-gateway/openai/gpt-4.1-mini`. Its six trials used
42 recall calls and 29,951 provider-reported tokens. The classifier meter recorded
138 calls, 230,901 tokens and no classifier failures. Classifier usage includes
the agent's classifier-backed retrieval and must not be counted twice.

The seven recorded probes cover three sessions and deliberately target older
archived evidence, including original codemode arguments. They are not a random
sample. Every search reached the 80-artifact cap. These results do not separate
archive exclusion from passage-ranking failures.

Local evidence lives in `../cache/context-recall-baseline-local/`. Hosted results
live in `../cache/context-recall-baseline-live/`. The aggregate report is
`../cache/context-recall-baseline-summary.json`. These private artifacts are not
committed. Keep them and their referenced input archives for the post-change run.

## Rerun

From the repository root, use fresh output directories.

1. Run the local recorded probes:

   ```bash
   bun run --cwd .pi/agent benchmarks/context-recall-baseline.ts --output "$PWD/.pi/agent/cache/context-recall-after-local" --recorded "$PWD/.pi/agent/cache/context-recall-baseline-local/recorded-probes.json"
   ```

2. Run the hosted synthetic probes:

   ```bash
   bun run --cwd .pi/agent benchmarks/context-recall-baseline.ts --output "$PWD/.pi/agent/cache/context-recall-after-live" --live --agent --model vercel-ai-gateway/openai/gpt-4.1-mini --repeats 3
   ```

3. Compare matching question IDs and recorded session/source hashes. Check
   correctness, abstention, citations, batch hits, tool calls and usage. Use
   `classifier-usage.json` for aggregate classifier usage. The usage fields in
   individual classifier reports are cumulative.

4. Run `devenv test`. The `test:pi-context-baseline` task includes the new scorer
   and read-only replay tests and their dedicated TypeScript project.

## Validation and limits

The two new tests, dedicated typecheck and Biome check passed. The combined
pre-change check had 28 passing tests and eight existing checkpoint-source
failures with `Invalid saved-result path`. `devenv test` stopped before running
tests because it could not create `/Users/fbb/.local/share/devenv/`, reporting
`File exists (os error 17)`. Logs remain with the local results.

The agent trials use the existing autonomous tool loop, not a complete Pi
extension lifecycle. They do not test images or agent recovery of exact original
arguments. Synthetic correctness does not establish real-session recoverability.
Three repeats provide a pilot baseline, not statistical equivalence evidence.
Before removing discovery cues, cover the older-archive retrieval gap independently.
