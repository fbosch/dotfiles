# Fast Jev compaction

This extension is an opt-in, global-only compaction handler. Enable it in
`~/.pi/agent/settings.json`:

```json
{
  "jev": {
    "compaction": {
      "enabled": true,
      "summaryModel": "openai-codex/gpt-6-luna-fast"
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
2. Jev receives bounded, redacted metadata: the goal, each batch's nearest
   preceding user context, tool names and inputs, and result sizes/error flags.
   It never receives tool-result bodies. Candidates are visited once, in order,
   up to 256 paired tool call/result candidates. Each round uses at most two
   concurrent requests of 14 calls each; each batch has a focused state so older
   candidates do not disappear behind the 96-message history window. Requests
   time out after 2.4 seconds and the whole Jev pass is capped at 12 seconds.
3. Failed results, unresolved errors, unknown tools, and non-read-only actions
   are protected. A call and its result are always decided together. Each round
   is atomic: no decision from it is used unless every response is complete and
   strictly validated. If a later round fails or is malformed, all provisional
   Jev decisions are discarded and Luna receives the original prepared context.
4. After each complete round, the extension renders the full Jev-pruned output,
   including removed-material excerpts and Pi's summary wrapper. It returns that
   output immediately when it has positive character savings and fits the
   `reserveTokens` estimate. Any positive savings qualify; there is no minimum
   reduction percentage. Removed long results carry an explicit truncation marker
   and re-run hint.
5. If all eligible calls are considered but the rendered output still has no
   positive savings or exceeds the reserve, `summaryModel` makes exactly one
   coherent checkpoint request from the original prepared old context through
   Pi's configured model registry. The full previous compaction summary is included
   so it is merged rather than dropped or nested. Hitting the 256-call or 12-second
   bound also checkpoints the original context, reported distinctly as
   `eligible-call-limit` or `jev-timeout`; unvisited calls are not labeled
   protected. Jev errors and malformed responses likewise checkpoint the original
   context. If Luna fails, is cancelled, or its output plus Pi's wrapper exceeds
   `reserveTokens`, Pi uses its native compactor. The status distinguishes a missing
   model, unsupported runtime API, auth/provider failure, malformed, empty,
   truncated, and aborted output without including raw provider errors.

Successful Jev-prune summaries prepend a deterministic continuity header. It
includes at most 600 redacted characters from the latest user message in the
compacted span, labels that request as potentially superseded by Pi's kept tail,
and lists up to 12 Pi-reported read and modified paths per category. Each path is
capped at 180 characters, and the header reports how many paths it omitted. These
are bounded excerpts, not a complete task-state summary. The header adds no
inferred progress, decisions, or next steps, and its text counts toward both the
savings and wrapped `reserveTokens` checks. The prior compaction summary remains
in the rendered transcript and is not repeated in the header.

A manual `/compact` with focus instructions bypasses this handler so Pi can
honor those instructions normally. Cancellation is terminal: no checkpoint
request is started after the abort signal.

Successful compactions persist versioned `fastJev` details containing the
protected message copy, path (`prune` or `checkpoint`), sanitized stage
millisecond timings, fallback reason where relevant, and before/after character
sizes. Version 1 details remain readable so existing persisted summaries are
not discarded. Failed attempts are exposed without transcript content through
the `fast_jev_compaction_status` event and the `/fast-jev-status` command.
Provider failures may include only a bounded exception classification, HTTP
status, and allowlisted provider code; messages, prompts, headers, bodies,
URLs, and stacks are never included.

## Data boundary and limitations

Redaction is best effort. It covers common credential assignments,
authorization headers, control characters, and home-directory paths, but it is
not a guarantee for arbitrary secrets or personal data. The summary model may
receive the full prepared old context, as Pi's native compactor does. Raw
session history remains in Pi's session file; compaction is not secure deletion.

The positive-savings check compares character counts, and the reserve check
estimates tokens as one per four wrapped-summary characters. Large retained
content, wrapper text, or deterministic excerpts can still make the rendered Jev
output ineligible. Conversely, a small positive reduction may not free enough
context to prevent another compaction soon. An ineligible render gets one configured
checkpoint attempt; native Pi compaction remains the final fallback.

An offline synthetic continuation test checks which anchors survive and which
dropped middle/end facts do not. It does not compare this output with Pi's native
compactor or establish continuation parity.
