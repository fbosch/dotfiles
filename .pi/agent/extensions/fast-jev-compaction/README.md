# Fast Jev compaction

This extension is an opt-in, global-only compaction handler. Enable it in
`~/.pi/agent/settings.json`:

```json
{
  "jev": {
    "compaction": {
      "enabled": true,
      "summaryModel": "openai-codex/gpt-5.6-luna-fast"
    }
  }
}
```

`summaryModel` remains configurable, but only the global settings object is
read. Project settings cannot enable or configure this adapter. Reload Pi after
changing the setting.

## Behavior

1. Pi supplies the old context and any split-turn prefix already selected for
   compaction. The recent Pi-kept tail is not otherwise added by this extension.
2. Jev receives bounded, redacted metadata: recent user/assistant text, tool
   names and inputs, and result sizes/error flags. It never receives tool-result
   bodies. At most 24 paired tool call/result candidates are judged, in batches
   of 14 questions per request. Independent batches run concurrently under one
   overall deadline.
3. Failed results, unresolved errors, unknown tools, and non-read-only actions
   are protected. A call and its result are always decided together. No Jev
   decision is applied until every batch response is complete and strictly
   validated.
4. If deterministic pruning reaches the existing 25% reduction gate **after**
   retained content, removed-material excerpts, and wrapper text are rendered,
   the extension returns immediately without a summary-model request. Removed
   long results carry an explicit truncation marker and re-run hint.
5. Otherwise, or when Jev is unavailable/uncertain, `summaryModel` makes exactly
   one coherent checkpoint request from the prepared old context through Pi's
   configured model registry. The full previous compaction summary is included
   in that request so it is merged rather than dropped or nested. If that
request fails, is cancelled, or its output plus Pi's summary wrapper exceeds
`reserveTokens`, the handler returns no result and Pi uses its native compactor. The
status distinguishes a missing model, unsupported runtime API, auth/provider failure,
malformed, empty, truncated, and aborted output without including raw provider errors.

A manual `/compact` with focus instructions bypasses this handler so Pi can
honor those instructions normally. Cancellation is terminal: no checkpoint
request is started after the abort signal.

Successful compactions persist versioned `fastJev` details containing the
protected message copy, path (`prune` or `checkpoint`), sanitized stage
millisecond timings, fallback reason where relevant, and before/after character
sizes. Version 1 details remain readable so existing persisted summaries are
not discarded. Failed attempts are exposed without transcript content through
the `fast_jev_compaction_status` event and the `/fast-jev-status` command.

## Data boundary and limitations

Redaction is best effort. It covers common credential assignments,
authorization headers, control characters, and home-directory paths, but it is
not a guarantee for arbitrary secrets or personal data. The summary model may
receive the full prepared old context, as Pi's native compactor does. Raw
session history remains in Pi's session file; compaction is not secure deletion.

The 25% gate and output budget use bounded character/token estimates. A large
retained context, wrapper, or deterministic excerpt can therefore reject the
fast path even when Jev selected useful removals. In that case the configured
checkpoint model gets one attempt; native Pi compaction remains the final
fallback.
