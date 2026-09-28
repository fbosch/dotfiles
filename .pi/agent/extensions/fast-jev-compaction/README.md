# Fast Jev compaction

Fast Jev compaction replaces Pi's compaction summary with a deterministic record of selected source spans. Enable it in global `~/.pi/agent/settings.json`:

```json
{
  "jev": {
    "compaction": {
      "enabled": true
    }
  }
}
```

Project settings cannot enable this adapter. The old `summaryModel` field is ignored; remove it when convenient. Reload Pi after changing the setting.

Phased compaction is separately opt-in under the same global object (`"phased": true` alongside `"enabled": true`). It is disabled by default, and the existing one-pass compactor remains unchanged otherwise. The phased path sends one coarse-selection wave and, only if needed, one targeted-refinement wave, with at most four logical requests per wave and eight total within the existing Jev deadline. Historical-retirement judgments share the coarse wave; they do not add a phase. It accepts only a fully rendered, wrapped output no larger than 20% of the prepared input by character count that also fits Pi's reserve-token estimate. This character bound is not a claim of 20% token savings or continuation parity. If the protected floor is too large, eligible historical spans are assessed before refusal; unsupported history remains protected. Irreducible floors and refinement that cannot meet both limits are refused without truncation. Only Jev availability failures delegate to Pi's native compactor; malformed answers, size refusals, and caller cancellation do not.

## Selection and output

The extension converts the prepared compaction span, including any split-turn prefix, into bounded source spans. Jev receives redacted text and makes typed retain-or-omit judgments. It does not write the summary. Code renders the chosen spans in source order with their kind, source message, offsets, and Pi's reported file operations.

The continuation matrix is conservative:

| Source | Handling |
| --- | --- |
| Prior compaction summary | Retain unless one judgment on the complete source group reaches ≥0.95 probability that the complete latest-user witness group explicitly duplicates, supersedes, or resolves it |
| Latest user message and constraints | Always retain, with source provenance |
| Earlier user messages | Retain unless one judgment on the complete source group reaches the same high threshold against the complete latest-user witness group |
| Non-read-only or unknown tool calls and their results | Always retain as action outcomes |
| Failed or unmatched tool results | Always retain |
| Assistant text and known read-only tool calls/results | Ask Jev whether each bounded span is useful |

Each retirement question pairs one complete historical source group with the complete latest-user witness group, named by source-group ID. Missing, malformed, uncertain, or unsupported judgments keep the historical group. The model's typed answer is not proof of semantic correctness; model accuracy for these retirement decisions is unverified. The renderer quotes copied source text and does not infer progress, decisions, or next steps. It redacts common credentials, control characters, and home-directory paths before both Jev requests and persisted output. Redaction is best effort, not a guarantee for arbitrary secrets or personal data.

Pi keeps messages after `firstKeptEntryId` itself. The extension reads only messages Pi prepared for compaction and the split-turn prefix; it never appends or repeats the retained tail. Manual `/compact` focus instructions are included as redacted selection context. The renderer remains selection-only, so those instructions cannot ask it to generate new prose.

## Limits and refusal

Each source span is at most 700 characters. The one-pass path processes the full prepared source in windows of at most 14 optional spans per Jev request, with at most two requests concurrently. It considers at most 1,024 spans overall (at most 74 Jev requests); source beyond that hard cap is refused rather than silently skipped. In the phased path, the coarse wave judges source groups, and optional refinement judges chunks of at most 16 spans. Each request has at most 16 questions, with at most four requests per wave and eight total; a wave accepts at most 64 candidates. Oversized payloads or groups are refused rather than truncated. Decisions are committed only after every window or wave returns a complete, valid answer set. Requests time out after 2.4 seconds and the complete Jev pass is capped at 12 seconds, so large passes can take nearly 12 seconds. If Jev is unavailable, including when that deadline expires, Pi's native compactor is used and may be slow. The configured Jev gateway can route an evaluation across its Jev providers.

A result is accepted only when every response is complete and strictly validates. The one-pass rendered summary must save at least 20% of the prepared text; the phased rendered summary must be no larger than 20% of the prepared text. Both must fit within 80% of Pi's `reserveTokens` estimate, counting Pi's summary wrapper at one token per four characters. The extension never truncates the selected output to force a fit.

If Jev is unavailable, the extension returns no compaction response so Pi can use its native compactor. Unavailability includes missing credentials, authentication failure, request timeout or the overall Jev deadline, request/transport or response-body failure, and HTTP 401, 403, 404, 408, 429, or 5xx. A provider's 404 may mean its configured Jev model is unavailable; Pi's native model is separate.

The extension explicitly refuses compaction instead of falling back for other HTTP statuses, invalid JSON, an oversized response body, malformed Jev answers, source-span or local-state limits, no source spans, unexpected errors, or failure to meet either size check. Caller cancellation is terminal and also returns an explicit cancellation response. Disable the setting to use Pi's ordinary compactor without attempting Jev.

Successful compactions persist version 3 `fastJev` metadata with selected span provenance, savings, and bounded timings. The extension still reads version 1 and 2 persisted details. Refusals report the measured protected size, candidate size, phase, and actual output size alongside the reason and span/request counts; refused, cancelled, and native-fallback attempts are also reported without transcript content through the `fast_jev_compaction_status` event and `/fast-jev-status` command. Fallback status times cover the Jev attempt, not Pi's subsequent native compaction.

Pi retains raw session history in its session file. Compaction is not secure deletion. The deterministic source-span format is not a generated summary and does not establish continuation parity with Pi's native compactor; benchmark work is tracked separately.
