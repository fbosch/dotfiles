# Semantic command guard

Configure the guard in `~/.pi/agent/settings.json`:

```json
{
  "classifier": {
    "commandGuard": {
      "enabled": true,
      "mode": "shadow"
    }
  }
}
```

Set `enabled` to `false` to disable this guard without disabling other classifier
features. Set `mode` to `"confirm"` to require approval for flagged bash calls.

The default mode is `shadow`. If `commandGuard` is absent, the guard defaults to
off. Invalid settings disable checks and produce one warning per session.
The global `classifier.enabled: false` switch also disables this guard.
The shared classifier policy respects trusted-project classifier opt-outs.

Run `/reload` once after installing the extension or updating its code. Settings
changes need no reload. The guard re-reads settings before each bash call and
before reporting a verdict or accepting approval.

## Modes

- `shadow` runs checks in the background and reports fixed risk descriptions.
  It never asks for approval or blocks execution. At most one check runs at a
  time; selected calls arriving while it is busy are skipped, not queued.
  Classification failures produce one warning per session, not a safe verdict.
- `confirm` waits for every selected call's verdict before execution. Unflagged
  calls proceed without a prompt. Flagged calls require interactive approval;
  declining, dismissing, or lacking a UI blocks execution. Parallel calls get
  separate approvals, with dialogs shown one at a time. Classification failures
  and cancellations block selected calls. Explicit classifier policy opt-outs
  disable checking rather than count as failures.

TUI approvals use the orange inline permission prompt in `prompt-ui`, with
`Allow once` and `Reject`. RPC keeps its standard confirmation dialog because
it does not support custom terminal components.

The TUI shows the risk category above a shaded command block. Local lexical
highlighting distinguishes executables, paths, operators, and warning tokens;
these colors are reading aids, not classifier explanations or proof of safety.
Long commands wrap with a continuation marker without omitting arguments.
Commands containing control or hidden formatting characters use an explicitly
escaped display. Approval still applies to the unchanged original command.

Confirm mode adds the classifier request duration to selected calls, plus any
time spent awaiting approval. The earlier isolated replay measured warmed
requests at 395–478 ms; this is an observation, not a latency guarantee.
Confirm requests allow 10 seconds overall, with up to 5 seconds for the primary
provider when a fallback is configured. Shadow requests retain their 2.4-second
overall budget. Both modes use the shared provider fallback policy.

Approval applies only to the exact command, working directory, session, and
mode that were reviewed. Changes during review invalidate it. Session switching
and shutdown cancel pending checks. Disabling the guard drops shadow reports
and invalidates pending confirmation calls instead of releasing them to execute.

The existing catastrophic-command guard remains unchanged. Confirm mode also
rejects its known patterns before classification, so there is no approval
override for those commands.

## Selection and privacy

The guard handles only bash calls, including calls nested inside codemode.
The codemode script itself is not classified. Local lexical filters select
deletion, overwriting, destructive Git operations, network transfers, and
inline code. Simple reads, ordinary Git inspection, and single-target deletion
of `dist`, `build`, or `.cache` skip classification.

Commands longer than 16,000 characters are not truncated. Shadow mode skips
them with a warning; confirm mode blocks them.

Only fixed operation labels and booleans go to the configured classifier
provider. The extension does not send or log raw commands, arguments, paths,
working directories, user messages, inline code, or tool output. The confirmation
dialog shows the command and working directory to the user, with control
characters escaped.

The summaries omit intent and detailed semantics. Quoting, comments, heredocs,
aliases, indirect execution, and unusual syntax can produce missed detections
or false alarms in either mode. A quiet guard does not establish safety or
permission. The initial probability thresholds are 0.9 for destructive changes
and 0.7 for possible uploads; they are not locally calibrated.
