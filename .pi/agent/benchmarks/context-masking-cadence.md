# Rolling masking cadence comparison

Compare three rolling-masking schedules while keeping eligibility, classifier instructions, history selection, masking, and recall behavior fixed.

- `ten-turn` assesses newly eligible outputs at turns 10, 20, and 30. With ten recent turns protected, the first nonempty batch occurs at turn 20.
- `token-budget` assesses when newly eligible, unassessed output bodies reach 4,000 estimated tokens. Assessment is checked after each scripted tool turn, independent of overall context fullness.
- `pressure` uses the production rule. It classifies once the 50% commit point of a 30,000-token synthetic window is close enough for the backlog, then holds its decisions. Held masks are committed together once the context estimate reaches 50% of the window and they free at least 10% of it, or at 90%. The window is scaled to the fixtures, whose final contexts reach 33–72% of it; the small-observation seed never reaches the commit point.

This is an isolated benchmark. It does not change production masking, register new production retention controls, or modify live settings.

## Run

The offline command uses deterministic simulated retention decisions and makes no provider calls. It validates scheduling, request bounds, projections, and preservation of exact originals. It does not measure model accuracy or cache behavior.

1. Enter the agent directory.

   ```sh
   cd .pi/agent
   ```

2. Run the offline comparison.

   ```sh
   bun benchmarks/context-masking-cadence.ts
   ```

Live mode requires existing credentials for `openai-codex/gpt-6.1-sol` and `openrouter/typesafe/jev-1.14`. It runs the offline comparison first, then permits at most 81 answer-model SDK invocations and 120 classifier SDK invocations across the whole campaign. Both set `maxRetries: 0`; the answer model uses SSE to avoid automatic WebSocket fallback. Requests have a 60-second deadline and the campaign has a 22.5-minute deadline. Counters describe client SDK invocations, not provider-internal attempts or billing.

3. Run the live comparison only when provider calls are intended.

   ```sh
   bun benchmarks/context-masking-cadence.ts --run
   ```

The command prints a fresh directory under `/tmp/context-masking-cadence-*`. It writes `preflight.json`, a live `report.json`, completed-run `partial.json`, and per-run `row.json` files. A failed live campaign exits nonzero. Its failed row can contain calls that are not present in the completed-run summary.

Run regression tests through the repository test workflow. The new task is `test:pi-context-masking-cadence`; the full `devenv test` includes it.

## Controls

Each arm sees the same 30-turn synthetic history for each of three workload shapes: small observations, bursty observations, and mixed observations. There is one seed per shape. Arm order rotates between seeds. A scripted turn is one assistant tool call plus its result. Answer probes and their recall follow-ups do not advance this clock.

All arms use:

- A ten-turn protected window and an 800-character minimum result size.
- A schema reference pinned until turn 26, and a structured tool failure protected until a later success with the same tool and arguments.
- The original user goal, latest observed user direction, and complete recent exchanges selected within a 12,000-byte history budget. Omitted turns are counted. No future probe answers enter classifier context.
- Complete candidate bodies and classifier requests bounded to 24,000 bytes. Candidates too large to fit are left verbatim and reported as deferred.
- The same classifier question. A keep probability of at least 0.35 retains the whole observation; lower probabilities permit an exact archive reference. Each observation is considered once. This comparison does not generate excerpts or summaries.
- A minimum batch saving of 100 estimated tokens. Already committed replacements remain stable. There is no forced final flush, so each row reports the remaining eligible backlog and, for `pressure`, its held masks.
- Disabled conversation compaction, fixed answer probes at turns 20, 25, and 30, and the same exact-ID archive retrieval tool. Turn 25 samples an unchanged-prefix interval between ten-turn masking batches. The production lexical recall and automatic prefetch pipeline are not under test.

Each main-model run gets a fresh system-prefix namespace from its in-memory session and a derived SDK `sessionId`. Both remain stable within that row and differ across cohorts, seeds, and arms. The Codex SDK maps the session ID to `prompt_cache_key`. The benchmark does not impose warmup calls, sleeps, or cache retention overrides; provider-side cache behavior remains uncontrolled. Answer-model reasoning uses the SDK default without an explicit override. Probes use disposable message arrays: their answers and retrieved originals do not become evidence for later probes. Live reports identify this behavior as `protocolVersion: 4`.

Each probe may request at most two archived observations, including parallel calls. An over-budget or undeclared-tool request fails that probe with zero correct facts; later probes continue. Provider failures still abort the campaign. A complete campaign means all scenarios ran, not that every probe passed.

`recalls` counts requested observations, including blocked requests; `recallsServed` counts successful original retrievals. `failedProbes` counts recorded probe execution failures. Wrong or malformed answers also reduce accuracy, even when no execution failure was recorded.

## Interpret the report

Start with fact accuracy, invalid answers, recall counts, completed pairs, and original preservation. Then compare classifier requests and time, probe time, and provider-reported main-model input and cache-read tokens. `modelUsage` and `classifierUsage` separate these sources; `usage` sums them. `usageComplete` indicates whether every recorded call supplied usage. Missing usage is not evidence of zero usage.

Estimated tokens use UTF-8 bytes divided by four. `estimatedSavedTokens` counts reductions when masks are committed, not cumulative billed savings. `estimatedProbeContextTokens` samples projected context before each probe; it excludes the new probe prompt, archive index, and additional retrieval requests. Use provider-reported usage for those calls.

SDK catalog costs are not actual Codex subscription billing. A zero reported price does not establish that a run was free. Zero reported cache reads do not establish that all provider caching was disabled.

These are scripted histories and fact-recovery probes, not autonomous coding tasks. Three workload shapes with one seed each support a pilot comparison, not a statistical winner. A production recommendation needs repeated paired runs and task-completion coverage, especially when one trigger saves tokens by making evidence harder to recover.
