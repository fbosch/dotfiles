# Skill discovery

One extension owns on-demand `skill_search` and automatic classifier recommendations. Both use the full discovered catalog; explicit-only skills and agent-specific invocation restrictions are excluded.

The initial prompt advertises only skills explicitly listed in global or project `skillTweaks.warmSkills`. Project scope alone does not pre-warm a skill. Project `coldSkills` overrides the warm lists; all other permitted skills remain searchable through `skill_search`. Skill bodies still load on demand. Invocation restrictions still apply to search and automatic recommendations. Restricted agents without a declared search tool and reader retain their permitted catalog. Automatic selection appends each new recommendation as a name, `SKILL.md` path, and the same bounded description the classifier evaluated. The agent still reads the skill before using it; recommendations never load skill bodies or override instructions.

`skill_search` ranks names and descriptions through the shared classifier, with BM25 fallback when classification is unavailable. Automatic recommendations use independent relevance scores and add nothing on missing credentials, timeouts, aborts, malformed responses, image prompts, or other classifier failures. Explicit `/skill:name` invocations bypass automatic selection. Neither path sends skill bodies; automatic selection sends the user prompt and bounded candidate metadata to the configured classifier.

Automatic selection runs once at input time and requires concrete evidence that a skill's described trigger or workflow applies to the requested action, with its required context established. Broad topic overlap and hypothetical usefulness do not qualify. A generic status check or "continue" request does not establish a specialized workflow unless the supplied state identifies it. The default threshold remains 0.72.

## Session-wide advice limits

Input-time checks use deduplication state on the active session branch. A skill is offered once; successful direct or nested `read` calls suppress future recommendations. Reloads and later requests reconstruct that state from branch history. Abandoned branches do not affect it.

Retained advisory messages share a 6,000-character budget, including escaped names, paths, descriptions, and boilerplate. Only complete skill records are admitted. If no eligible record fits, classification is skipped with `advisory-budget-exhausted`; the extension does not force compaction. Chat-only announcements do not count toward this budget.

Advice stays append-only between compactions to preserve existing prompt prefixes. Normal compaction can drop old advisory messages and free capacity; retained advice still counts. Session-wide deduplication survives compaction. The limit covers owned advisory text, not skill bodies or mentions preserved in a compaction summary, and does not guarantee provider cache hits.

Run `/reload` to load extension changes. `/classifier-status` reports the latest input-time selection state, reason, timing, and fetch status. Its `advisory` object reports the 6,000-character limit, used and remaining characters, and the number of skills offered on the active branch. Session changes and newer requests cancel pending classification and discard stale responses.

## Shared classifier gateway routing

Configure provider preferences in global `~/.pi/agent/settings.json`. The first provider is preferred; the gateway makes at most one fallback attempt in the configured order. Each attempt uses its provider's registry credentials and adapter. The first attempt receives roughly half the caller's total deadline when a fallback is configured; fallback work never extends that deadline. Valid `Retry-After` responses cool down that provider while other configured providers remain eligible.

```json
{
  "classifier": {
    "providers": [
      { "provider": "openrouter", "model": "typesafe/jev-1.14" },
      { "provider": "openrouter", "model": "openai/gpt-6-luna-decisions" }
    ]
  }
}
```

If `classifier.providers` is absent, the requester uses the list above. Both models accept text and images. Each entry names a registered classifier model; its native adapter handles the wire model ID. Missing or incompatible models are skipped. Malformed preference lists fail closed before auth or network access. Project settings do not override these global provider preferences.

Automatic recommendations are enabled in this repository's global settings, but disabled by default in the extension. Configure them through `settings.json` or a trusted project settings file:

```json
{
  "classifier": {
    "skillSelection": {
      "enabled": true,
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
