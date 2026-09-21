# Advisory skill selection

This extension asks Jev for independent relevance scores over the skills Pi has already discovered. It appends recommendations only; it never removes the native catalog, loads a skill, or changes explicit `/skill:name` behavior.

Skills with `disable-model-invocation` metadata or names denied by `skillTweaks` are excluded before the request. A missing credential, timeout, abort, malformed response, image prompt, or other Jev failure leaves the original system prompt unchanged.

The feature is disabled by default. Opt in through `settings.json` or a trusted project settings file:

```json
{
  "skillSelection": {
    "enabled": true,
    "threshold": 0.72,
    "timeoutMs": 600,
    "maxRecommendations": 3
  }
}
```

The offline benchmark is opt-in and uses only frozen synthetic requests:

```sh
cd ~/.pi/agent
bun run benchmark:skill-selection
```

That command runs the lexical baseline without network access. Passing `-- --jev --timeout-ms 600 --output /tmp/skill-selection.json` explicitly permits one hosted Jev pass. `-- --hosted-compare` runs the same 40 synthetic fixtures once at each of 600 ms and 2000 ms, with no retries, and saves a bounded report under `$XDG_STATE_HOME/dotfiles/skill-selection-benchmarks/` by default. Reports contain fixture IDs, predictions, safe failure categories, elapsed time, usage, and aggregate quality/coverage/latency; they never contain credentials, headers, raw bodies, or prompts. Hosted commands are never part of startup or `devenv test`.
