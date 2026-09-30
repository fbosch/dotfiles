# Classifier settings

To disable classifier requests everywhere, set `classifier.enabled` to `false` in `~/.pi/agent/settings.json`:

```json
{
  "classifier": {
    "enabled": false
  }
}
```

Use the same setting in `<project>/.pi/settings.json` to opt out for a trusted project. Project `true` cannot override global `false`. An omitted switch defaults to `true`; malformed settings prevent requests.

Run `/reload` once after installing this extension. The policy re-reads settings before each request, so later switch changes need no reload. It covers the shared requester and native `modelRegistry.classify()`, including codemode `models.classify()`. Existing integrations retain their fallback or error behavior when classification is disabled. Ordinary chat-model calls are unaffected.
