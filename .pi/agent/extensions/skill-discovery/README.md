# Skill discovery

One extension owns on-demand `skill_search` and automatic classifier recommendations. Both use the full discovered catalog, including cold skills; explicit-only skills and agent-specific invocation restrictions are excluded.

Warm skills remain in Pi's structured prompt. Cold skills stay out of the catalog sent to the agent. For a matching user prompt, automatic selection adds only recommended skill names and `SKILL.md` paths in a structured `skill_recommendations` section. The agent still reads the skill before using it; recommendations never load skill bodies or override instructions.

`skill_search` ranks names and descriptions through the shared classifier, with BM25 fallback when classification is unavailable. Automatic recommendations use independent relevance scores and add nothing on missing credentials, timeouts, aborts, malformed responses, image prompts, or other classifier failures. Explicit `/skill:name` invocations bypass automatic selection. Neither path sends skill bodies; automatic selection sends the user prompt and bounded candidate metadata to the configured classifier.

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
      "threshold": 0.72,
      "timeoutMs": 2400,
      "maxRecommendations": 3
    }
  }
}
```

The offline benchmark is opt-in and uses only frozen synthetic requests:

```sh
cd ~/.pi/agent
bun run benchmark:skill-selection
```

That command runs the lexical baseline without network access. Passing `-- --classifier --timeout-ms 600 --output /tmp/skill-selection.json` explicitly permits one hosted classifier pass. `-- --hosted-compare` runs the same 40 synthetic fixtures once at each of 600 ms and 2000 ms, with no retries, and saves a bounded report under `$XDG_STATE_HOME/dotfiles/skill-selection-benchmarks/` by default. Reports contain fixture IDs, predictions, safe failure categories, elapsed time, usage, and aggregate quality/coverage/latency; they never contain credentials, headers, raw bodies, or prompts. Hosted commands are never part of startup or `devenv test`.
