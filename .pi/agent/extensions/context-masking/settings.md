# Context masking

This extension hides old, large tool results from the model's context before Pi needs to compact. Each hidden result is saved to a local file, and a short placeholder in the conversation points to it. User messages, assistant messages, tool calls, and recent tool results stay verbatim. Deterministic masking and local recall do not call a model. The optional classifier compaction candidate below is disabled by default.

## Enable masking with native compaction

Add this to the global `~/.pi/agent/settings.json` and run `/reload`:

```json
{
  "contextMasking": {
    "enabled": true,
    "prefetchRecall": true
  },
  "contextClassifierCompaction": {
    "enabled": false
  },
  "compactionModel": {
    "enabled": false
  }
}
```

This configuration uses Pi's built-in summarizer with the active conversation model. Masking and recall remain enabled; neither custom compaction handler runs.

Masking reads global settings only. Malformed masking settings leave context unchanged.

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Turns masking on. |
| `prefetchRecall` | `false` | Add matching saved passages when a new text request arrives. Requires `enabled`. |
| `triggerRatio` | `0.7` | Mask once Pi's context estimate reaches this share of the context window. |
| `protectRecentTurns` | `10` | Tool results from the latest N assistant turns stay verbatim. |
| `minResultChars` | `800` | Shorter results stay verbatim. |
| `minFreedRatio` | `0.15` | Skip a batch that would free less than this share of the context. |

The defaults come from replaying recorded sessions with `bun run --cwd .pi/agent benchmark:context-masking`.

## What happens

At the end of a turn, if context usage is at or above the trigger, the extension:

1. Selects tool results older than the protected turns that are at least `minResultChars` long. Results that contain images, or that are already masked or omitted, stay as they are.
2. Writes each result's text to `~/.pi/agent/cache/context-masking/<session-id>/<entry-id>.txt`, readable only by you. A result that cannot be written is not masked.
3. Replaces each result in future model context with a placeholder that names the tool, its size, and the file path, using Pi `context_edit` entries.
4. Records a `context-masking` custom entry with the number of results masked, the estimated tokens freed, and each hidden result's entry ID, tool, and file path.

The raw session file keeps every original result, and `/tree` navigation to a point before the edit shows the originals again.

A hidden result remains available through `read` at its saved path. The extension also registers a deferred `recall` tool that returns matching passages. Tool discovery can activate it; to declare it at startup, add `"+recall"` to `defaultTools`. Automatic lookup does not activate the tool or change the active tool list.

The `recall` tool accepts either `query` for one question or `queries` for one to eight distinct questions. For example, `{"queries":["Which schema was approved?","What retention period was approved?"],"limit":2}` retrieves both in one scan. `limit` applies per question. All questions share the same scan and output budgets, and each gets an output allowance so the first cannot consume the whole response.

## Automatic saved-output lookup

With both `enabled` and `prefetchRecall` on, the extension searches saved output once per new text request. It parses up to 8,000 prompt characters into at most eight questions of 500 characters each. It recognizes ordinary English and Danish questions and bullet lists. A single request still uses at most 500 characters as its query. Each prefetched question needs a match for at least two distinct terms within three neighboring lines. A strong question does not admit weak matches for another question. The extension appends the passages as historical data at the conversation tail. It does not rewrite earlier messages or append an identical lookup result already in visible context.

Lookup is local and does not call a classifier. It only reads artifacts recorded on the current session branch, under the masking cache, with the expected entry filename. It rejects symlinked files and session directories. Each lookup scans at most the newest 80 artifacts, 128 KiB per file and 2 MiB total. Returned text is capped at 12,000 characters; long lines are excerpted. The output reports skipped files and scan limits. Full saved files remain available through `read`.

The two-term gate is a lexical heuristic, not a relevance guarantee. It can miss paraphrases or add irrelevant context when terms overlap. Automatic lookup stops when either setting is off; the deferred `recall` tool remains available for existing saved output.

The synthetic discovery probe separates model-directed recall from automatic lookup:

```bash
PROBE_RECALL=1 PROBE_PREFETCH=1 PI_BIN=/path/to/unwrapped/pi \
  bun .pi/agent/benchmarks/context-artifact-discovery-probe.ts
```

Omit `PROBE_PREFETCH=1` to test the tool alone. The probe records correctness, retrieval behavior, tokens and latency. Its gateway pacing is excluded from measured response time. These small synthetic cases do not establish real-task quality.

## Interaction with compaction and caching

Masking runs as a batch, then history stays append-only until the next batch. Each batch changes context from the first masked result onward, so the next request rewrites the provider's prompt cache from that point. `minFreedRatio` stops small batches that would cost a cache rebuild for little gain.

Pi re-estimates context from the edited projection as soon as a masking batch is committed, before its own compaction check. If masking frees enough, compaction does not run on that turn. Otherwise, the configured compaction path runs. A generative fallback sees placeholders instead of the hidden results.

## After compaction

A compaction summary can drop placeholders and their file paths, which would leave hidden results unreachable. After a compaction, the extension adds an index of saved results to each request, right after the compaction summary. The index lists each result whose placeholder is no longer in context, with its tool, command or path, and file. It lists at most 40 results, newest first, and skips files that no longer exist.

The index is built from session entries, not from the summary, so it works whichever extension writes the summary. It is added per request rather than stored in the session. It changes only when a new compaction lands, so it does not break the prompt cache between compactions. It is added even when `enabled` is `false`, because earlier batches may still hide results.

Extractive checkpoints contain their selected references or a pointer to a saved reference manifest. Hybrid checkpoints keep the catalogue in session entries and expose it through recall. Neither receives the general index again.

## Classifier compaction candidate

The extension includes an experimental classifier-driven alternative to generative compaction. It is disabled by default. This repository opts into an extractive live trial after approval to send eligible content to Jev. Masking, batched recall and native fallback remain enabled; hybrid mode stays off.

Enabling it sends conversation text, tool arguments, masks, artifact addresses, eligible saved output and normalized image copies to the configured classifier provider. The synthetic evaluations send generated data only. Do not enable it for recorded sessions without accepting that data transfer.

```json
{
  "contextClassifierCompaction": {
    "enabled": true,
    "mode": "extractive",
    "provider": "openrouter",
    "model": "typesafe/jev-1.14",
    "includeContent": true,
    "maxOutputBytes": 4000,
    "maxRequestBytes": 28000,
    "maxConcurrentAssessments": 2
  },
  "compactionModel": {
    "enabled": false,
    "model": "openai-codex/gpt-6-luna",
    "thinkingLevel": "xhigh"
  }
}
```

This is a separate global setting, not a field inside `contextMasking`. With `enabled: false`, the compaction hook makes no artifact reads or classifier requests.

The host archives ordinary user and assistant text, the previous summary and unmasked tool output before classification. Each text unit has a content-addressed `.txt` file under the session's artifact directory. The session catalog also records its exact snapshot so bounded recall can verify retrieved text. Jev receives complete candidate text, tool arguments and normalized images with the same goal, current task and compaction focus. It cannot open local files itself. `includeContent: false` withholds hydrated tool output, not conversation text or images.

In the default `extractive` mode, Jev receives two probability questions per source unit in a combined assessment request. They choose `inline`, `reference` or `omit`. The shared rules distinguish working facts needed without another lookup from supporting evidence. The host assembles selected text in source order, keeps call/result provenance and retains exact source line ranges. An omission removes content from active context, not from its archive. Uncertain prose keeps a reference. The classifier cannot replace text or supply new addresses.

If retained references make a checkpoint exceed its budget, the host archives reference groups in a manifest and leaves one pointer in active context. The manifest preserves saved addresses, original call metadata and reference order. When inline choices alone exceed the cap, the host keeps higher-confidence working units as exact text and changes lower-priority units to references. At equal confidence, it favors user text, then newer units. Image addresses can move to a manifest without changing which pixels the extension restores.
Manifests use the same private, content-addressed store and 4 MB per-file cap. Their metadata does not consume the original-text archive budget. Use bounded read or recall to inspect them. Hybrid native-summary input is not replaced by a manifest pointer.

Ordinary prose, prior summaries and unmasked tool outputs participate even when no masked tool results exist. Only an empty eligible prefix returns `no-content`. Pi stores the selected history as a labeled summary string, not the original structured messages. The native retained tail stays outside these decisions. Images use the shared goal and retention path below; ambiguous call identities or unsupported content use native fallback.

| Setting | Default | Meaning |
|---|---|---|
| `mode` | `"extractive"` | Use extractive checkpoints or opt in to `"hybrid"` native summaries. |
| `maxSummaryInputBytes` | `48000` | Hybrid input budget for selected messages and the previous summary. |
| `maxRequestBytes` | `24000` | Serialized classifier state and questions per request. |
| `maxConcurrentAssessments` | `1` | Maximum independent extractive assessment requests in flight (1–4). Decisions apply in source order; reconciliation and hybrid mode remain sequential. |
| `maxArtifactBytes` | `12000` | Tool-output read limit and maximum complete prose-unit size eligible for classification. Larger units keep a reference. |
| `maxTotalArtifactBytes` | `256000` | Existing-output read budget per window and separate new-original write budget per archive window; each attempt also has a 4 MB write ceiling. |
| `maxArtifacts` | `40` | Maximum tool results per read window and new originals per archive window, not per compaction. Prose has a separate 256-unit ceiling. |
| `maxOutputBytes` | `24000` | Extractive checkpoint text limit, excluding Pi wrappers, the retained tail and restored image pixels. Does not cap a hybrid native summary. |
| `threshold` | `0.5` | Extractive probability threshold. Inline takes precedence over a reference. |
| `minFreedRatio` | `0.25` | Required extractive reduction for text-only attempts. Image attempts use output and transport bounds instead of this text-byte estimate. |

This repository sets `maxRequestBytes` to `28000` for a bounded packet-size trial. The default remains `24000`. A 137-source synthetic history took 32 requests at `28000` instead of 38 at `24000` with the same retained decisions. The three-seed hosted cohort took 45 requests and recovered 18/18 facts at either limit. The effect on a live compaction remains unmeasured.

This repository also permits two assessment requests in flight. The host waits for both on failure or cancellation and accounts for completed paid replies. Reconciliation still waits for all assessment decisions and runs in order. Concurrency changes latency, not request count or the checkpoint-expansion limit.

The host renews read and archive windows before a result or original would cross their count or byte limits. A single new original must fit its archive window, and new originals cannot exceed 4 MB across an attempt. Packet packing is independent of these windows and obeys `maxRequestBytes`. Shared instructions, source metadata and identical content appear once per packet. Distinct source decisions remain separate even when their text is identical. Audit totals cover the entire attempt and can exceed a single window's limits. Cancellation stops later requests.

When inline working selections come from multiple assessment packets, the host first tries one joint reconciliation request. If it exceeds `maxRequestBytes`, it compares overlapping bounded windows instead; each window contains exact selected source text. A window that cannot fit two selections is skipped. Bounded windows can turn an older inline selection into a reference only when the classifier identifies an explicit later same-subject revision in that window; other selections remain inline until checkpoint budgeting. The audit sets `reconciliationIncomplete` when the joint view was unavailable: distant revisions can remain unresolved. This may still fall back if retained inline text exceeds the checkpoint cap. Single-packet selections and supporting references require no separate role request. There is no mandatory metadata-screening pass or generated summary.


Prior extractive checkpoints and manifests expand through the session catalog before reassessment. The expansion preserves source text and call metadata, flattens repeated references and rejects unknown addresses, changed snapshots, symlinks and cycles. It has a separate `maxTotalArtifactBytes` read budget, a 256-address ceiling and an eight-level nesting limit. Validated source archives are reused rather than copied into new conversation snapshots, leaving the original-text archive budget for unsaved text. Native summaries remain ordinary complete text candidates.

This repository sets `maxOutputBytes` to `4000` for extractive mode. The host reserves space for a reference manifest, then uses the classifier's inline probabilities, source role and recency to choose exact text that fits. `budgetDemotions` counts inline choices moved to references; originals remain in their archives. If the checkpoint still cannot fit, compaction falls back to normal compaction.

These are byte limits, not exact token counts. The source-unit parser only separates strongly repeated log framing from adjacent non-log blocks. It keeps multiline conditions, fenced code and structured documents atomic. Other formats remain whole until a supported parser is added. Oversized or unclassifiable units keep references. Request context uses marked excerpts of prior state and recent evidence; the current task and compaction focus remain complete. If that context or the checkpoint cannot fit, or classification fails, the hook uses Pi's native summarizer with the global `compactionModel.model` and `compactionModel.thinkingLevel`. If new text cannot be archived within its limits, the hook cancels instead. Each text archive has a 4 MB hard limit. Cancellation also cancels the attempt. Missing fallback settings, an unavailable model or a failed native summary do not retry with the active conversation model.

Accepted extractive checkpoints contain references directly or point to their recovery manifest. The general post-compaction index does not reinsert addresses that this candidate omitted. Session records, exact artifacts and local recall remain available.

Successful checkpoints carry classifier usage. Paid fallback attempts have separate `context-masking-classifier-compaction` audit entries. Those entries preserve reported usage but do not add it to the default summary's headline usage. Telemetry stores source IDs, line ranges, decisions, budget demotions, archive windows and sizes, not classifier packets or saved output. `assessmentRequests` and `reconciliationRequests` count actual text-classifier requests. `expandedReferences` counts archived references read while expanding prior checkpoints. `checkpointUnpackedBytes`, `checkpointBytes` and `checkpointInlineBytes` report text bytes before packing, after packing and without reference groups. Restored pixels are not included.

Pi runs all `session_before_compact` handlers, and the last non-cancel result wins. Multiple custom compactors can spend money even when only one result is committed. This repository keeps `pi-compaction-model` installed but disables its standalone handler. The classifier hook owns extractive checkpoints and native fallback in the live trial. Both hybrid summaries and fallback read the global `compactionModel` model and thinking level while the standalone compactor is disabled. Its `enabled` and `reasons` fields do not gate those requests.

Trusted project settings must not re-enable `compactionModel` while the global classifier is enabled.

To restore the dedicated generative compaction model:

1. Set `contextClassifierCompaction.enabled` to `false`.
2. Set `compactionModel.enabled` to `true`.
3. Run `/reload`.

The benchmark uses the extension's `classifyCompaction` function:

```bash
bun .pi/agent/benchmarks/context-classifier-candidate.ts
CLASSIFIER_DISTRACTORS=12 bun .pi/agent/benchmarks/context-classifier-candidate.ts routing
```

The second command adds closed background outputs to exercise pruning of surplus pointers. Both runs use synthetic coding continuations and identical continuation-time retrieval. The benchmark checks a 1,600-token ceiling with provider-reported counts, uses a tighter 4,000-byte checkpoint cap, and includes failed candidate work and summary fallbacks in cost. It does not measure longitudinal cache savings.

## Image retention

Classifier compaction archives eligible single-frame PNG and JPEG images before making provider requests. Originals are content-addressed files under `~/.pi/agent/cache/context-masking/<session-id>/image-<id>.png` or `.jpg`. Files have owner-only permissions, and existing originals are never overwritten. Reads validate the session, expected path, size and SHA-256 digest and reject symlinked sessions or files.

Text selection judges ordinary prose and tool output with normalized images and the shared retention goal. A separate image pass receives the same current task, prior-state context and compaction focus, alongside the selected text. Both passes can run without any previously saved tool outputs. Each decision controls active context:

- `inline` restores the original pixels from the verified archive after the summary on subsequent model requests.
- `reference` keeps a saved path that the main agent can read when needed.
- `omit` removes both pixels and the path from the active checkpoint. The saved original and session archive record remain intact.

Uncertain image decisions keep a reference. Classifier errors use native fallback and conservatively keep archived images inline. If originals cannot be archived or verified, the hook cancels compaction instead of discarding them. If a kept image later becomes unavailable, context includes an explicit missing-pixels notice. Nothing deletes an image automatically.

The deferred `recall_images` tool finds references by source label, identifier or path, including pruned images. It searches the latest 80 image archive records on the current branch, returns at most eight references and validates at most 16 MB per call. It does not search visual contents or call a model. Use `read` on a returned path to view its pixels. Older originals remain on disk and in session records even when outside this bounded lookup.

The image path allows at most 32 originals and 16 MB per attempt, with a 4 MB and 8-million-pixel limit per original. ImageMagick creates metadata-stripped classifier copies with white padding rather than upscaling small images. Copies fit 256–1,568 pixels per side, 78,400–2,458,624 pixels in area and 500 KB encoded. The source pixels remain unchanged. The serialized multimodal packet has a separate 1 MB ceiling; `maxRequestBytes` still bounds its text state and questions. `includeContent: false` disables saved-text hydration, not image transfer.

Valid decision reuse requires identical image evidence, text, focus, model and settings. Normalization failure or packet limits use native fallback. Invalid or unsupported originals cancel compaction. The image processor currently requires `/run/current-system/sw/bin/magick`; this path is NixOS-specific. Descriptor-pinned directory operations reduce path-swap risk on Linux. Other platforms use canonical paths without equivalent concurrent-swap protection.

Unified text and image retention has offline tests with synthetic data and stub classifiers, including the live hook, pruned-prose recall and text-only prefixes. Hosted multimodal Jev behavior remains unverified. The earlier four-way benchmark measured the saved-tool-output selector, not unified prose pruning or image retention.

## Experimental hybrid summaries

Hybrid mode is opt-in.

```json
{
  "contextClassifierCompaction": {
    "enabled": true,
    "mode": "hybrid",
    "includeContent": true,
    "maxSummaryInputBytes": 48000
  }
}
```

The classifier gets one evidence-selection question per complete saved result. It excludes a result only when its relevance probability is at most 0.1. Uncertain results stay in the selected evidence. Partial results keep their trusted saved path and a partial-excerpt notice without classification. Hybrid classifier packets repeat non-candidate conversation state rather than every candidate's placeholder.

The host restores selected source text into coherent call/result pairs. It preserves user and assistant text, combines the chronological prefix into one native summary request, and leaves Pi's retained-history boundary unchanged. The configured native summarizer updates the working summary from that evidence and the previous summary. The model can still omit or misstate facts; selecting evidence does not guarantee summary quality.

The 48,000-byte limit covers the selected message representation and previous summary. It is separate from the extractive 4,000-byte checkpoint cap. Hybrid output follows native summarization rather than rejecting a useful summary solely for exceeding that extractive cap. The checkpoint carries a short recall hint. The complete saved-result catalogue stays in session entries instead of taking space in the working summary.

Valid classifier responses can be reused from a bounded, in-memory cache of 64 packets per active session. Reuse requires identical task state, artifact identities and content, model, settings and request. Any change to that evidence scope invalidates reuse. Cancelled classifier passes and invalid answers do not populate the cache. Hits avoid provider requests and do not add old usage again. The cache does not survive an extension reload.

Accepted hybrid checkpoints include fresh classifier and native-summary usage. Audit entries report classifier requests, cache hits, sizes and decisions without saved contents. Native fallback also restores validated file lists from preceding extension-created checkpoints.

The initial three-seed paired run accepted three hybrid checkpoints and used native fallback for six. All six fallbacks hit `summary-input-limit`: the selector retained too much evidence at the second and third checkpoints. That result does not justify enabling hybrid mode by default.

Offline preflight makes no provider requests:

```bash
bun .pi/agent/benchmarks/context-native-comparison.ts --hybrid
```

The hosted comparison uses generated evidence only:

```bash
bun .pi/agent/benchmarks/context-native-comparison.ts --hybrid --run
```

It pairs the hybrid with a fresh native baseline on three seeds of one synthetic template. Both arms use manual checkpoints, native retention defaults, the same source files, at most 12 model requests per final probe and 52 tool attempts. Failed probes remain in the results. Each arm starts fresh sessions, so this comparison does not establish longitudinal cache savings. Actual Codex subscription billing is not available from SDK token counts.

To compare native summaries with masking and batched recall against the hybrid, use the recall ablation:

```bash
bun .pi/agent/benchmarks/context-native-comparison.ts --recall-ablation
bun .pi/agent/benchmarks/context-native-comparison.ts --recall-ablation --run
```

The first command runs offline preflight. The second makes hosted requests with generated evidence only. Both arms enable masking and batched prefetch, and only the hybrid enables classifier compaction. The comparison uses three fresh seeds of the same synthetic template and keeps the request limits and native retention defaults unchanged.

Both arms recovered 18/18 facts in the three-seed recall ablation. Recorded compaction and probe time totaled 172.3 seconds for native summaries plus recall versus 203.6 seconds for hybrid. The arms made zero and 57 classifier requests respectively. This comparison did not include extractive classifier compaction and does not establish real-task quality or automatic compaction performance.

For a fresh comparison of plain native, native with masking and batched recall, extractive classifier compaction, and hybrid summaries:

```bash
bun .pi/agent/benchmarks/context-native-comparison.ts --four-way
bun .pi/agent/benchmarks/context-native-comparison.ts --four-way --run
```

The first command runs offline preflight; the second makes hosted requests with synthetic evidence only. All four arms use identical fresh seeds and unchanged per-arm limits. Arm order rotates across three seeds, which does not fully balance four positions. Extractive classifier compaction still allows native fallback, and the results count that work. Live settings remain unchanged.

The four-way comparison recovered 18/18 facts in every arm. Extractive classifier compaction was fastest and used the fewest main-model tokens, with native fallback at three of nine checkpoints. That result supports a trial, not a general reliability claim. The live trial retains `openai-codex/gpt-6-luna` with `xhigh` thinking for fallback, as explicitly selected. The benchmark used `openai-codex/gpt-6.1-sol` with thinking off, so its timing and cost estimates do not directly predict this live fallback configuration.

## Limits

- Artifacts are not deleted automatically. Remove a session's directory under `~/.pi/agent/cache/context-masking/` when you no longer need to recall its results.
- A placeholder still names the artifact path after the file is deleted, and the model can no longer recall that result.
- Results are masked by age and size only. The extension does not judge whether an old result is still relevant.
