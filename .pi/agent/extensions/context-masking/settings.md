# Context masking

This extension hides old, large tool results from the model's context before Pi needs to compact. Each hidden result is saved to a local file, and a short placeholder in the conversation points to it. User messages, assistant messages, tool calls, and recent tool results stay verbatim. It does not call a model.

## Enable it

Add this to the global `~/.pi/agent/settings.json` and run `/reload`:

```json
{
  "contextMasking": {
    "enabled": true
  }
}
```

Only the global setting is read. Malformed settings leave context unchanged.

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Turns masking on. |
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
4. Records a `context-masking` custom entry with the number of results masked and the estimated tokens freed.

The raw session file keeps every original result, and `/tree` navigation to a point before the edit shows the originals again.

To see a hidden result again, the model calls `read` on the path in the placeholder, using `offset` and `limit` for long files. No extra tool is registered, so masking never changes the tool list.

## Interaction with compaction and caching

Masking runs as a batch, then history stays append-only until the next batch. Each batch changes context from the first masked result onward, so the next request rewrites the provider's prompt cache from that point. `minFreedRatio` stops small batches that would cost a cache rebuild for little gain.

Pi re-estimates context from the edited projection as soon as a masking batch is committed, before its own compaction check. If masking frees enough, compaction does not run on that turn. When masking cannot keep context under Pi's compaction threshold, normal compaction, including `pi-compaction-model`, still runs; its summary then sees placeholders instead of the hidden results.

## Limits

- Artifacts are not deleted automatically. Remove a session's directory under `~/.pi/agent/cache/context-masking/` when you no longer need to recall its results.
- A placeholder still names the artifact path after the file is deleted, and the model can no longer recall that result.
- Results are masked by age and size only. The extension does not judge whether an old result is still relevant.
