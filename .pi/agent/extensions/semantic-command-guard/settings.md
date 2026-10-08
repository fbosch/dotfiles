# Semantic command guard

Set `classifier.commandGuard.enabled` to `false` in
`~/.pi/agent/settings.json` to disable this guard without disabling other
classifier features:

```json
{
  "classifier": {
    "commandGuard": {
      "enabled": false
    }
  }
}
```

The setting is re-read before each bash call and before a pending verdict is
reported. No reload is needed after changing it. An omitted switch defaults to
off. Invalid settings disable checks and produce one warning per session.
The global `classifier.enabled: false` switch also disables this guard.
The shared classifier policy still respects trusted-project classifier opt-outs.

This is a bash-only, non-blocking shadow experiment. It never confirms or blocks
execution. The existing catastrophic-command guard remains unchanged.

Local lexical filters select deletion, overwriting, destructive Git operations,
network transfers, and inline code. Simple reads, ordinary Git inspection, and
single-target deletion of `dist`, `build`, or `.cache` skip classification.
Nested bash calls from codemode use the same hook; the script itself is not
classified. At most one check runs at a time; selected calls arriving while it
is busy are skipped, not queued. Commands longer than 16,000 characters are
skipped with a warning rather than truncated.

Only fixed operation labels and booleans go to the configured classifier
provider. Raw commands, arguments, paths, working directories, user messages,
inline code, and tool output are not sent or logged by this extension.
Notifications contain only fixed risk descriptions.

The summaries omit intent and detailed semantics. Quoting, comments, heredocs,
aliases, indirect execution, and unusual syntax can produce missed detections
or false alarms. A quiet guard does not establish safety or permission.
The initial probability thresholds are 0.9 for destructive changes and 0.7
for possible uploads; they are not locally calibrated. Requests use the shared
classifier timeout and fallback policy. Failures produce one warning per
session, not a safe verdict. Session switching and shutdown cancel pending
checks.
