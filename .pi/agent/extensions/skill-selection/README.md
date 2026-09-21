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

That command runs the lexical baseline without network access. Passing `-- --jev` explicitly permits hosted Jev requests for those synthetic fixtures; it is never part of startup or `devenv test`.
