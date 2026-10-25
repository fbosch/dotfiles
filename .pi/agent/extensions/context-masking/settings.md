# Context masking

This extension hides old, large tool results from the model's context before Pi needs to compact. Each hidden result is saved to a local file, and a short placeholder in the conversation points to it. User messages, assistant messages, tool calls, and recent tool results stay verbatim. It does not call a model.

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

Pi re-estimates context from the edited projection as soon as a masking batch is committed, before its own compaction check. If masking frees enough, compaction does not run on that turn. When masking cannot keep context under Pi's compaction threshold, normal compaction, including `pi-compaction-model`, still runs; its summary then sees placeholders instead of the hidden results.

## After compaction

A compaction summary can drop placeholders and their file paths, which would leave hidden results unreachable. After a compaction, the extension adds an index of saved results to each request, right after the compaction summary. The index lists each result whose placeholder is no longer in context, with its tool, command or path, and file. It lists at most 40 results, newest first, and skips files that no longer exist.

The index is built from session entries, not from the summary, so it works whichever extension writes the summary. It is added per request rather than stored in the session. It changes only when a new compaction lands, so it does not break the prompt cache between compactions. It is added even when `enabled` is `false`, because earlier batches may still hide results.

## Limits

- Artifacts are not deleted automatically. Remove a session's directory under `~/.pi/agent/cache/context-masking/` when you no longer need to recall its results.
- A placeholder still names the artifact path after the file is deleted, and the model can no longer recall that result.
- Results are masked by age and size only. The extension does not judge whether an old result is still relevant.
