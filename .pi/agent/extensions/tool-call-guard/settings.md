# Tool-call guard

The extension checks every Pi `tool_call` in this order:

1. **Catastrophic commands.** Known catastrophic Bash patterns, such as
   recursive deletion of `/` or formatting a block device, are always blocked.
   No setting disables them and no approval overrides them.
2. **Protected files.** Direct changes to the guard and settings files require
   interactive approval, whatever the classifier settings. See
   [Protected files](#protected-files).
3. **Command review.** Other Bash calls follow `classifier.commandGuard`.

The guard narrows risk; it does not replace the sandbox.

## Command review settings

Configure command review in `~/.pi/agent/settings.json`:

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

Set `enabled` to `false` to disable semantic command checks without disabling
other classifier features. Set `mode` to `"confirm"` to require approval for
flagged bash calls.

The default mode is `shadow`. If `commandGuard` is absent, semantic checks
default to off. Invalid settings disable semantic checks and produce one warning
per session. The global `classifier.enabled: false` switch also disables them.
Trusted-project classifier opt-outs prevent hosted classification.
Protected-file approval is independent of all classifier settings.

Run `/reload` once after installing the extension or updating its code. Settings
changes need no reload. The guard re-reads settings before each bash call and
before reporting a verdict or accepting approval.

## Modes

- `shadow` runs semantic checks in the background and reports fixed risk
  descriptions. It does not ask for command approval or block execution. At most
  one check runs at a time; selected calls arriving while busy are skipped.
  Classification failures produce one warning per session, not a safe verdict.
- `confirm` waits for every selected call. Supported commands with unflagged
  classifier verdicts proceed without a prompt. Flagged commands require
  interactive approval; declining, dismissing, or lacking a UI blocks
  execution. Parallel
  calls get separate approvals, with dialogs shown one at a time. Classification
  failures and cancellations block selected calls. Explicit classifier policy
  opt-outs bypass hosted checks rather than count as failures.

Both modes retain the independent protected-file gate described below.

TUI approvals use the orange inline permission prompt in `prompt-ui`, with
`Run command` and `Cancel`. RPC keeps its standard confirmation dialog because
it does not support custom terminal components.

The warning identifies possible destructive changes or a local data upload.
A fixed-label summary does not establish actual
targets, effects, or authorization.

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

Catastrophic commands never reach command review, so no mode offers an
approval override for them.

## Selection and privacy

Semantic inspection handles bash calls, including calls nested inside codemode.
The codemode script itself is not classified. A bounded literal-shell parser
separates executable words, quoted data, comments, pipelines, and literal
redirection targets. It recognizes absolute executables only under `/bin` and
`/usr/bin`.

Nono grants define what commands may touch. Command review adds checks only for
destructive and transfer operations. Supported deletion, overwriting,
history-rewriting Git operations (`push`, `reset`, `clean`, `rebase`, `branch`),
and transfers produce fixed labels for classification. This includes
`find -delete`, `tee`, and output truncation with `>`. Quoted code printed as
data does not become an operation. Other programs, `cd`, reads, and ordinary Git
work such as `status`, `log`, `commit`, or `checkout` run without review.

Syntax the parser cannot resolve (substitutions, heredocs, expansions, control
flow), wrappers such as `sudo` or `xargs`, and interpreters are scanned as text.
Text naming a destructive or transfer operation, such as `rm`, `dd`, or
`git push`, goes to the classifier with `lexicalOnly: true`. Other opaque code,
including scripts and inline Python or Node, runs without review: nono grants
bound what it can reach. The parser is not a complete shell AST and does not
inspect script contents or resolve aliases.

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
unknown options, unresolved shell syntax, inline code, network transfers, and
destructive Git operations remain eligible for semantic review.
Nono bypass exceptions overlapping denied paths also remain under review.

A narrow temporary-script exemption also accepts this form:

```bash
T=$(mktemp -d /tmp/guard.XXXXXX) && chmod 700 "$T" && touch "$T/file" && rm -rf "$T"
```

The template must be an absolute literal path with a trailing run of at least
three `X` characters. The variable must be `T` or a lowercase name starting
with a letter and containing only letters, digits, and underscores. Every
operation must follow `&&`, so creation failure skips all file operations.
Targets must be double-quoted references to that variable, optionally followed
by literal child components without `.` or `..`.

Only supported `rm`, `rmdir`, `unlink`, `chmod`, `truncate`, `touch`, and
`shred` operations qualify. Permission changes must use numeric owner-only
modes such as `600` or `700`. Copies, moves, ownership changes, other commands,
redirections, and variable reassignment remain under review. The entire
template parent must have a directory write grant and no denied descendants.
The exemption checks the parent conservatively rather than inventing the
future random directory name.

Bare `mktemp -d` remains unresolved because its parent depends on the shell's
environment. Scripts such as GPG key-generation tests still require review;
recognizing their cleanup path does not establish the effects of every command.
No command, path, or grant information is added to classifier requests.

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

The summaries omit intent, operand roles, and detailed semantics. Runtime
configuration, aliases, indirect execution, and unsupported option semantics can
still cause missed detections or false alarms. A quiet guard does not establish
safety or permission. The probability thresholds remain 0.9 for destructive
changes and 0.7 for possible uploads; they are not locally calibrated.

## Protected files

A deterministic gate requires approval for direct mutations of this extension
(including its catastrophic-command rules), global agent settings, and the current project's
`.pi/settings.json`. It runs even when semantic checks are disabled, invalid, or
in shadow mode. Headless changes fail closed.

The gate covers `write`, `edit`, hashline mutation tools, and Bash commands
whose semantics name mutation targets: `>`/`>>` redirects; every operand of
`rm`, `rmdir`, `unlink`, `shred`, `truncate`, `touch`, `tee`, `mkdir`, `chmod`,
`chown`, and `chgrp`; `mv` sources and destination; `cp`, `ln`, and `install`
destinations, including files placed inside a destination directory; `dd of=`;
and `sed -i` files. Arguments of other commands, including `cd`, Git, and
readers, are not treated as paths. Relative targets after `cd` are checked
against both the previous and the new directory. The gate resolves symlinks and
detects ancestor mutations.

Cross-file `copy` and `move` resolve source and destination anchors through the
installed hashline package's active session registry. Anchors the registry does
not know pass through, because the tool rejects them itself. An unavailable
registry or an unresolvable target opens the approval prompt with that reason
instead of blocking outright. If the guard cannot resolve its own protected
paths, it blocks mutations with an internal-error message and lets other calls
run.

The prompt uses the same inline permission component as command review, titled
`Change command guard files?` for Bash and `Allow <tool> to change command guard
files?` for file tools, which show their input instead of a command.

Approval applies only to the exact tool input and resolved paths. Session
changes, cancellation, working-directory changes, changed input, and retargeted
symlinks invalidate approval. Catastrophic commands cannot be approved.
Protected-file dialogs share the command-approval queue and expose input only
locally.

This gate is not a sandbox: opaque scripts and dynamically constructed paths
cannot yield verified mutation targets, so the gate does not inspect them.
Their execution remains subject to the configured command checks and runtime
confinement. Disabling command checks
does not make arbitrary script execution safe.

## Evaluation

`evals/tool-call-guard/replay.ts` replays synthetic calls through the
actual handler without executing commands. Its offline mode measures routing,
not classifier accuracy. Use opt-in `--live` for provider/model-specific
observations before considering threshold changes. See the evaluation README.
