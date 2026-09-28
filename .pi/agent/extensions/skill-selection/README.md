# Advisory skill selection

This extension asks Jev for independent relevance scores over the skills Pi has already discovered. It appends recommendations only; it never removes the native catalog, loads a skill, or changes explicit `/skill:name` behavior.

Skills with `disable-model-invocation` metadata or names denied by `skillTweaks` are excluded before the request. This extension uses the shared Jev gateway, whose ordered provider preferences apply to all Jev-backed callers. Both adapters use Pi's provider auth registry; missing credentials, timeouts, aborts, malformed responses, image prompts, and other Jev failures leave the original system prompt unchanged.

## Shared Jev gateway routing

Configure provider preferences in global `~/.pi/agent/settings.json`. The first provider is preferred; the gateway makes at most one fallback attempt in the configured order. Each attempt uses its provider's registry credentials and adapter. The first attempt receives roughly half the caller's total deadline when a fallback is configured; fallback work never extends that deadline. Valid `Retry-After` responses cool down that provider while other configured providers remain eligible.

```json
{
  "jev": {
    "providers": [
      { "provider": "openrouter", "model": "typesafe/jev-1.13" },
      { "provider": "vercel-ai-gateway", "model": "typesafe-ai/jev" }
    ]
  }
}
```

If `jev.providers` is absent, the same OpenRouter-first order is used. OpenRouter model IDs use the `typesafe/` namespace with a Jev alias (`jev-latest`, `jev-preview`) or version (`jev-X.Y` / `jev-X.Y.Z`); the adapter sends the suffix as the wire model ID. The current Vercel route accepts `typesafe-ai/jev` and sends that ID unchanged. Unknown providers, unsupported provider/model pairs, duplicate providers, malformed lists, or malformed settings fail closed before auth or network access. Project settings do not override this global shared routing configuration.

The feature is disabled by default. Opt in through `settings.json` or a trusted project settings file:

```json
{
  "jev": {
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

That command runs the lexical baseline without network access. Passing `-- --jev --timeout-ms 600 --output /tmp/skill-selection.json` explicitly permits one hosted Jev pass. `-- --hosted-compare` runs the same 40 synthetic fixtures once at each of 600 ms and 2000 ms, with no retries, and saves a bounded report under `$XDG_STATE_HOME/dotfiles/skill-selection-benchmarks/` by default. Reports contain fixture IDs, predictions, safe failure categories, elapsed time, usage, and aggregate quality/coverage/latency; they never contain credentials, headers, raw bodies, or prompts. Hosted commands are never part of startup or `devenv test`.
