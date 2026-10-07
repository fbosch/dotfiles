# Skill discovery

One extension owns on-demand `skill_search` and automatic classifier recommendations. Both use the full discovered catalog, including cold skills; explicit-only skills and agent-specific invocation restrictions are excluded.

Warm skills remain in Pi's structured prompt. Cold skills stay out of the catalog sent to the agent. Automatic selection appends each new recommendation as a name, `SKILL.md` path, and the same bounded description the classifier evaluated. The agent still reads the skill before using it; recommendations never load skill bodies or override instructions.

`skill_search` ranks names and descriptions through the shared classifier, with BM25 fallback when classification is unavailable. Automatic recommendations use independent relevance scores and add nothing on missing credentials, timeouts, aborts, malformed responses, image prompts, or other classifier failures. Explicit `/skill:name` invocations bypass automatic selection. Neither path sends skill bodies; automatic selection sends the user prompt and bounded candidate metadata to the configured classifier.

Automatic selection requires concrete evidence that a skill's described trigger or workflow applies to the requested action or remaining work, with its required context established. Broad topic overlap and hypothetical usefulness do not qualify. A generic status check or "continue" request does not establish a specialized workflow unless the supplied state identifies it. Input and mid-task checks use the same rule; completed tools alone do not establish future intent. The default threshold remains 0.72.

## Session-wide advice limits

Initial and mid-task checks share deduplication state on the active session branch. A skill is offered once; successful direct or nested `read` calls suppress future recommendations. Reloads and later requests reconstruct that state from branch history. Abandoned branches do not affect it.

Retained advisory messages share a 6,000-character budget, including escaped names, paths, descriptions, and boilerplate. Only complete skill records are admitted. If no eligible record fits, classification is skipped with `advisory-budget-exhausted`; the extension does not force compaction. Chat-only announcements do not count toward this budget.

Advice stays append-only between compactions to preserve existing prompt prefixes. Normal compaction can drop old advisory messages and free capacity; retained advice still counts. Session-wide deduplication survives compaction. The limit covers owned advisory text, not skill bodies or mentions preserved in a compaction summary, and does not guarantee provider cache hits.

## Mid-task experiment

When `classifier.skillSelection.enabled` and `classifier.skillSelection.midTaskEnabled` are true, `turn_end` can make up to two additional classifier attempts per user request. The input check has a separate attempt budget. Both append advisory messages to model context, with separate chat entries showing skill names. Neither changes the system prompt, edits earlier advice, loads skill bodies, blocks tools, or forces another model turn.

`midTaskEnabled` defaults to true in the extension. Repository settings disable it
to keep input-time suggestions and `skill_search` without mid-task classifier
calls. The [input-only ablation](../../evals/skill-suggestions/INPUT-ONLY-RESULTS.md)
found little demonstrated benefit from the extra checks in its synthetic tasks.
The independent switch remains available for future evaluations.

The local gate requires a completed tool-driven turn, observed non-terminating tool results, no queued user message, changed evidence, and eligible skills that have not been read or recommended. Final responses, errors, aborts, unknown tool-completion metadata, and terminating tool batches skip the check. Failed and no-match attempts consume the budget; unchanged evidence is not retried. Session changes cancel pending checks and discard stale responses.

Each bounded snapshot carries the user goal, visible assistant excerpts, unique completed-tool labels and outcomes, and changes since the last attempt. Tool observations support the activity description rather than define future intent. Paths and successful direct or nested `read` calls identify loaded skills locally, but tool arguments, file bodies, raw output, and hidden thinking are not sent. Known credential patterns in visible text are redacted before truncation. Redaction is best-effort, not a guarantee that arbitrary sensitive prose is safe to send to the configured classifier.

The gate is deliberately heuristic. Repeated reads with unchanged visible text add no evidence; new wording or a new tool outcome may trigger a check without a genuine workflow change. Improve this gate if evaluations show wasted checks or missed transitions. The initial version sends no tool-result summaries beyond labels and outcomes, so findings must appear in visible assistant text to inform selection.

Run `/reload` to load the extension changes. `/classifier-status` includes `midTask` attempt count, state, safe reason, and timing for the latest checkpoint. Its `advisory` object reports the 6,000-character limit, used and remaining characters, and the number of skills offered on the active branch. It does not include snapshot text or tool results.

## Shared classifier gateway routing

Configure provider preferences in global `~/.pi/agent/settings.json`. The first provider is preferred; the gateway makes at most one fallback attempt in the configured order. Each attempt uses its provider's registry credentials and adapter. The first attempt receives roughly half the caller's total deadline when a fallback is configured; fallback work never extends that deadline. Valid `Retry-After` responses cool down that provider while other configured providers remain eligible.

```json
{
  "classifier": {
    "providers": [
      { "provider": "openrouter", "model": "typesafe/jev-1.13" },
      { "provider": "vercel-ai-gateway", "model": "typesafe-ai/jev" }
    ]
  }
}
```

If `classifier.providers` is absent, the same OpenRouter-first order is used. OpenRouter model IDs use the `typesafe/` namespace with a Jev alias (`jev-latest`, `jev-preview`) or version (`jev-X.Y` / `jev-X.Y.Z`); the adapter sends the suffix as the wire model ID. The current Vercel route accepts `typesafe-ai/jev` and sends that ID unchanged. Unknown providers, unsupported provider/model pairs, duplicate providers, malformed lists, or malformed settings fail closed before auth or network access. Project settings do not override this global shared routing configuration.

Automatic recommendations are enabled in this repository's global settings, but disabled by default in the extension. Configure them through `settings.json` or a trusted project settings file:

```json
{
  "classifier": {
    "skillSelection": {
      "enabled": true,
      "midTaskEnabled": false,
      "threshold": 0.72,
      "timeoutMs": 2400,
      "maxRecommendations": 3
    }
  }
}
```

Automatic selection deadlines accept integer `timeoutMs` values from 1 to 5000.
The default and repository setting remain 2400 ms. A longer deadline is an
explicit opt-in for slower classifier responses, not an extra retry budget.

The offline benchmark is opt-in and uses only frozen synthetic requests:

```sh
cd ~/.pi/agent
bun run benchmark:skill-selection
```

That command runs the lexical baseline without network access. Passing `-- --classifier --timeout-ms 600 --output /tmp/skill-selection.json` explicitly permits one hosted classifier pass. `-- --hosted-compare` runs the same 40 synthetic fixtures once at each of 600 ms and 2000 ms, with no retries, and saves a bounded report under `$XDG_STATE_HOME/dotfiles/skill-selection-benchmarks/` by default. Reports contain fixture IDs, predictions, safe failure categories, elapsed time, usage, and aggregate quality/coverage/latency; they never contain credentials, headers, raw bodies, or prompts. Hosted commands are never part of startup or `devenv test`.
