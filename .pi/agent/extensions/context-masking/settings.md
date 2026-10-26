# Context masking

This extension hides old, large tool results from the model's context before Pi needs to compact. Each hidden result is saved to a local file, and a short placeholder in the conversation points to it. User messages, assistant messages, tool calls, and recent tool results stay verbatim. Deterministic masking and local recall do not call a model. The optional classifier compaction candidate below is disabled by default.

## Enable it

Add this to the global `~/.pi/agent/settings.json` and run `/reload`:

```json
{
  "contextMasking": {
    "enabled": true,
    "prefetchRecall": true
  }
}
```

Only the global setting is read. Malformed settings leave context unchanged.

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

## Automatic saved-output lookup

With both `enabled` and `prefetchRecall` on, the extension searches saved output once per new text request. It uses the first 500 characters of the request as a lexical query. At least two distinct query terms must occur within three neighboring lines for the extension to add a result. It appends up to two passages as historical data at the conversation tail; it does not rewrite earlier messages. An identical lookup result already in visible context is not appended again.

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

## Classifier compaction candidate

The extension includes a classifier-driven alternative to generative compaction. It is disabled by default in the extension and enabled in this repository's global settings.

Enabling it sends conversation text, tool arguments, masks, artifact addresses and eligible saved output to the configured classifier provider. The synthetic evaluations send generated data only. Do not enable it for recorded sessions without accepting that data transfer.

```json
{
  "contextClassifierCompaction": {
    "enabled": true,
    "provider": "openrouter",
    "model": "typesafe/jev-1.14",
    "includeContent": true,
    "maxOutputBytes": 4000
  },
  "compactionModel": {
    "enabled": false,
    "model": "openai-codex/gpt-6-luna",
    "thinkingLevel": "xhigh"
  }
}
```

This is a separate global setting, not a field inside `contextMasking`. With `enabled: false`, the compaction hook makes no artifact reads or classifier requests.

The host resolves artifacts recorded on the current branch and reads them through the same path and symlink checks as local recall. Jev receives the actual output alongside the original call, mask and saved address. It cannot open local files itself. With `includeContent: false`, requests omit the hydrated output but still contain the visible conversation and metadata.

Two probability questions per result decide whether the full output needs to remain inline and whether the call and reference are useful. The host renders coherent pairs as full output, saved references, or omissions. It never deletes an artifact. The decisions cannot supply replacement addresses.

The candidate preserves user and assistant text in order, unrecorded tool results and the previous summary. Pi stores this extractive history as a labeled summary string, not as the original structured messages. Ambiguous tool-call identities, images and other unsupported content cause normal compaction to take over.

| Setting | Default | Meaning |
|---|---|---|
| `maxRequestBytes` | `24000` | Serialized classifier state and questions per request. Batches repeat shared conversation state. |
| `maxArtifactBytes` | `12000` | Maximum bytes read from one artifact. Partial output keeps a reference without classification. |
| `maxTotalArtifactBytes` | `256000` | Maximum artifact bytes per attempt. |
| `maxArtifacts` | `40` | Maximum saved results considered per attempt. |
| `maxOutputBytes` | `24000` | Maximum UTF-8 bytes in the rendered checkpoint, excluding Pi wrappers and the retained tail. |
| `threshold` | `0.5` | Minimum probability for an inline or reference decision. Inline takes precedence. |
| `minFreedRatio` | `0.25` | Required additional reduction in rendered history bytes. |

This repository sets `maxOutputBytes` to `4000` to match the synthetic trials. Conversation text or checkpoints that cannot fit the configured limits fall back to normal compaction.

These are byte limits, not exact token counts. The host does not abridge conversation text to fit a classifier request. It retains a reference when an individual result cannot fit. If the conversation itself is too large, an artifact cannot be read safely, or a limit prevents a valid checkpoint, the hook runs Pi's native summarizer with the global `compactionModel.model` and `compactionModel.thinkingLevel`. Malformed classifier answers and API failures also fall back. Cancellation cancels the attempt instead of starting another model request. Missing or invalid fallback settings, an unavailable model, or a failed summary cancel the attempt rather than retrying with the active conversation model.

Selected references are embedded in accepted checkpoints. The general post-compaction index does not reinsert addresses that this candidate omitted. Session records, exact artifacts and local recall remain available.

Successful checkpoints carry classifier usage. Paid fallback attempts have separate `context-masking-classifier-compaction` audit entries. Those entries preserve reported usage but do not add it to the default summary's headline usage. Telemetry stores decisions and sizes, not classifier packets or saved output.

Pi runs all `session_before_compact` handlers, and the last non-cancel result wins. Multiple custom compactors can spend money even when only one result is committed. This repository keeps `pi-compaction-model` installed but sets `compactionModel.enabled` to `false`. The classifier hook owns both extractive checkpoints and generative fallback. The fallback reads the global `compactionModel` model and thinking level even while the standalone compactor is disabled; `enabled` and `reasons` do not gate classifier fallback.

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

## Limits

- Artifacts are not deleted automatically. Remove a session's directory under `~/.pi/agent/cache/context-masking/` when you no longer need to recall its results.
- A placeholder still names the artifact path after the file is deleted, and the model can no longer recall that result.
- Results are masked by age and size only. The extension does not judge whether an old result is still relevant.
