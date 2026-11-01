# Codex prefix-compaction experiment

This is an opt-in prototype, not an installation of `pi-prefix-cache-compaction`.
It adapts the package's append-only summary request to Pi's Codex Responses provider.
The prototype lives in `benchmarks/`, so normal extension discovery does not load it.
Daily settings remain unchanged.

## Status

The 14 focused tests and scoped TypeScript check pass against installed Pi SDK 1.4.0
through `devenv`. The previous full-agent check reported unrelated extension errors.
The hosted pilot completed all six runs; daily settings remained unchanged.

## Observed pilot: `cohort-ooEd1I`

Two seeds completed all three arms on `gpt-6-luna-fast`, thinking `max`.
Source: `.pi/agent/cache/context-prefix-comparison/cohort-ooEd1I/report.json`.
Every paired prefill and visible-tail fingerprint matched. System state, exact
within-arm retained messages, shared archives and live settings passed integrity
checks. All 26 application calls have recorded usage.

| Arm and summary engine | Mean uncached input per compaction | Mean total compaction tokens | Mean compaction pause | Exact answers |
| --- | ---: | ---: | ---: | ---: |
| Our extractor, Jev | 32,168 | 33,784 | 1.05 s | 12/12 |
| Prefix replay, Codex | 333 | 6,154.5 | 10.57 s | 10/12 |
| Native summary, Codex | 5,003 | 6,056.5 | 17.69 s | 9/12 |

Total tokens include cached input and output. Jev and Codex have different pricing
and quota rules; summing their token counts does not establish subscription savings.

Prefix replay cached 5,120 of 5,453 summary input tokens: 93.9%. Against native
Codex summarization, it used 93.3% less uncached summary input and completed the
compaction 40.3% faster, but used 1.6% more total compaction tokens.

Including the first post-compaction probe, mean uncached input was 33,597 for our
extractor, 2,332 for prefix replay, and 7,054.5 for native. Mean combined latency was
7.45 s, 18.02 s, and 24.63 s respectively. Prefill work is excluded from these
figures but remains in each row's `usage` and `calls`.

**Keep our daily configuration.** Replay caching worked, but prefix compaction
was 10 times slower than extraction and failed the predeclared exact-answer gate.
These strict misses could reflect omitted evidence or answer wording; the report
does not retain generated answer text, so their cause remains unknown. None of the
probes invoked recall. This pilot therefore does not establish archive-recovery
quality or behavior with daily automatic prefetch enabled.

Three earlier setup cohorts failed and remain in the cache:
`cohort-0khVcp` (unrouted fast alias), `cohort-hKNn6k` (system-message source-ID
relocation), and `cohort-i7CBoG` (cross-request text signatures). They are excluded
from the paired table, not counted as successful comparisons. There was also one
minimal failed model-routing diagnostic. These attempts added requests; unavailable
usage on rejected model requests is not evidence of zero billing.

## What the pilot compares

Every arm uses the same Codex model and thinking level, synthetic evidence,
archive contents, tool access, native cut point policy, and probe questions.
Each arm sends a real pre-compaction request to establish its own cache.
Seeds rotate arm order. Cache residency remains provider-controlled.
Prefill payload fingerprints must match after normalizing isolated paths and session
IDs. Retained visible-message fingerprints must match across arms and remain unchanged
during compaction. Volatile timing, usage, provider text signatures and thinking blocks
are excluded only from cross-arm fingerprints. Within-arm retained-message integrity
uses a hash of the complete messages, and system state is checked separately. The experiment forces
SSE transport and disables model retries to make application request counts bounded.
The loader includes production fast-model routing. Native summary requests receive
the same alias-to-base-model and priority-tier transform; captured prefix payloads
already contain that routing and retain it unchanged.

- `extractive` uses our classifier compactor with Jev, two concurrent assessments,
  28,000-byte request packets and a 4,000-byte inline text limit.
- `prefix` replays the captured full Codex payload with one summary instruction
  appended. It preserves instructions, tools, reasoning settings and cache identity.
  The response must finish without tool calls and fit 4,000 UTF-8 bytes.
- `native` uses Pi's generative summarizer on the same Codex model and thinking
  level as `prefix`. This control is included by default. It distinguishes prefix
  reuse from extraction versus generation; Jev extraction is a workflow reference.
  Native summaries over the common text budget fail the arm; their usage is retained.

The pilot keeps 1,024 estimated tokens of recent history to bound its workload.
It uses manual compaction, not daily automatic thresholds. Its small fixture should
not trigger rolling masking. Both arms have explicit recall and identical source
archives. Automatic prefetch is disabled so a probe does not inject its answers
without a measured retrieval request. Images, repeated compactions, warm-up and
background summarization are outside this pilot.

The same byte cap does not make extraction and generation equivalent algorithms.
Compare quality and total usage together. A lower uncached-input count alone is
not proof of fewer total tokens or lower subscription consumption.
The extraction limit excludes checkpoint wrappers and archive references; its total
checkpoint can exceed 4,000 bytes. Report the actual checkpoint sizes. Before a larger
trial, require all six answers correct with no stale values, at least 10% less
uncached compaction-plus-probe input than native, and no more than 10% median latency
regression. Two seeds provide a smoke comparison, not statistical evidence.

## Validate and run

Use the installed SDK mappings and the repository's devenv environment.
The live run uses configured credentials through `ModelRuntime`. Do not copy tokens,
disable proxies, strip credential guards, or invoke the runtime behind the launcher
to evade a sandbox restriction.

1. Validate the implementation.

   ```sh
   devenv --option enterTest:string \
     'cd .pi/agent && bun run sdk:sync && bun test benchmarks/__tests__/codex-prefix-compaction.test.ts benchmarks/__tests__/context-prefix-comparison.test.ts && bun run tsc --noEmit --project benchmarks/tsconfig.prefix-comparison.json' test
   ```

2. Inspect the offline plan. This does not initialize credentials or call providers.

   ```sh
   bun run --cwd .pi/agent benchmarks/context-prefix-comparison.ts
   ```

3. Run the three-arm pilot, with the native control.

   ```sh
   bun run --cwd .pi/agent benchmarks/context-prefix-comparison.ts \
     --run --model=gpt-6-luna-fast --thinking=max --seeds=2
   ```

The live command makes paid or subscription-counted requests to Codex and Jev.
Each arm has a limit of eight model requests and 32 classifier requests, including
recall, with a 180-second deadline per operation. Failed or oversized summaries
cancel compaction rather than silently switching to native. Do not load the
prototype alongside our enabled classifier compactor in a daily session.

Reports are private files under
`<agent-dir>/cache/context-prefix-comparison/cohort-*/`.
`report.json` records phase timings, request usage, missing usage, checkpoint bytes,
strict fact scores, stale answers, archive integrity, and whether live settings
changed. `partial.json` preserves completed calls if an arm fails.
It does not persist captured provider payloads, headers or credentials.

Compare these fields:

- `compactionUsage` for compaction input, output, cache reads and classifier work.
- `usage` for all recorded work, including prefill and recall-assisted probes.
- `compactionMs` and `probeMs` for the pause and first post-compaction operation.
- `score` for exact current approvals, identifiers, Danish paths and unknown-value abstention.
- `usageMissing`, failed requests and failed arms before drawing a token conclusion.

SDK cost estimates do not establish actual Codex subscription billing.
Report failures as failures. Do not drop an unsuccessful arm from the comparison.

## Safeguards and remaining risks

Authentication and transport stay in the installed model registry. Captures exist
only in memory. A completed turn binds a capture to its session, model, thinking
level and projected history. Committed masks, new messages, branch navigation,
model changes and compaction invalidate reuse. Lifecycle aborts cancel in-flight work.

The prototype remains experimental; only this bounded synthetic pilot has run.
Arbitrary extension header transforms are not replayed, and daily extension
combinations have not been tested.
The isolated loader excludes project context, skills and filesystem tools.
Only bounded `tool_search` and `recall` calls are allowed during the probe.
A cancelled attempt can still consume provider tokens.
