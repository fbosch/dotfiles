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
`Run command` and `Cancel`. RPC keeps its standard confirmation dialog because
it does not support custom terminal components.

The warning shows the flag cause: possible destructive changes, a local data
upload, or both. The guard's lexical summary does not establish actual execution,
targets, or effects.

The TUI keeps the risk category and decision controls outside a bounded review
pane. Use `PgUp`/`PgDn` to scroll, `Home`/`End` for the beginning and end,
and `Ctrl+Y` to copy the unchanged command. The pane shows its position and keeps
all command content available. Actual newlines remain line breaks; literal escape
sequences remain literal. Hidden controls use a JSON-escaped display per source
line. Local token colors are reading aids, not verdicts. Approval still applies
to the unchanged original command.

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
inline code. Simple reads and ordinary Git inspection skip classification.

File operations skip semantic review only when every resolved access matches
the runtime filesystem grants in `NONO_CAP_FILE`, parsed by `lib/nono-capabilities.ts`. Reads require `read` or
`readwrite`; mutations require `write` or `readwrite`. File grants match exactly,
and directory grants include descendants. No worktree or `/tmp` exemptions
are hardcoded. Narrow the nono profile to narrow the agent's permitted scope.

The exemption recognizes standalone literal `rm`, `rmdir`, `unlink`, `mv`,
`cp`, `truncate`, `chmod`, `chown`, `touch`, `tee`, and `shred` calls with
supported options. Relative paths use the working directory. Symlinks resolve
before parent traversal. Copy sources require read access, and copy destinations
require write access. Mixed or ungranted targets, denied paths and their parents,
unknown options, shell expansion, compound commands, inline code, network
transfers, and destructive Git operations remain eligible for semantic review.
Nono bypass exceptions overlapping denied paths also remain under review.

Missing, unreadable, or malformed runtime metadata silently disables path
exemptions; semantic review continues normally. Launching Pi without nono is
supported and does not trigger a warning. Runtime metadata is a launcher signal,
not proof of kernel enforcement.
The extension does not parse the source Nix profile or reproduce nono's policy
inheritance. Catastrophic-command checks remain unchanged.

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
