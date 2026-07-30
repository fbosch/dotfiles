# Behavior Contracts

Apply these rules independently of the visual renderer. Existing public contracts take priority over these defaults.

## Modes

Treat these as separate axes:

| Axis | Modes |
| --- | --- |
| Interaction | Interactive, non-interactive |
| Format | Human, plain, JSON, JSONL |
| Decoration | Styled, no-color, plain |
| Verbosity | Quiet, normal, verbose, debug |
| Destination | TTY, redirected, pipe, CI |

TTY detection may change decoration and safe interaction only. It must not silently change data schema, operation scope, field selection, exit semantics, or destructive behavior.

## Streams and Exit Status

Default stream contract:

- Put primary result or data on stdout.
- Put prompts, progress, warnings, diagnostics, and errors on stderr.
- Keep structured stdout strictly machine-readable.
- Keep live streams exclusive to their documented channel.
- Preserve a stable existing stream contract when it differs.

Default exit codes:

- `0`: success, no-op, expected empty result, or declined interactive confirmation before mutation
- `1`: operational failure
- `2`: invalid invocation

Do not normalize existing public exit codes without an explicit migration. The final exit code and user-visible outcome must agree.

## Profiles

| Profile | Required behavior |
| --- | --- |
| Human workflow | Apply visual house style and show relevant state changes |
| Query or report | Use scan-first list, table, detail, or empty-state output |
| Filter | Keep stdout exact; normally remain silent on success |
| Machine protocol | Do not run human rendering; follow the documented schema and failure channel |
| Interactive command | Provide a non-interactive input route for every prompt |
| Live stream | Do not reflow as a static table or overlay with progress |
| Transparent wrapper | Preserve child bytes, streams, exit status, and signals |
| CI adapter | Let the CI protocol override ordinary rendering |
| Stable public CLI | Preserve grammar, streams, and parseable output over style normalization |

## Profile Composition

When profiles overlap, resolve them in this order:

1. Existing public compatibility contract
2. CI adapter or transparent-wrapper protocol
3. Machine format and live-stream ownership
4. Interaction and safety requirements
5. Human visual language

Apply the first applicable contract to a conflicting surface. Apply lower rules only where they do not alter the higher contract.

Examples:

- A stable public human workflow keeps its established flags, streams, and exit codes, then adopts the house style only where presentation is not parseable.
- A JSON command may prompt only before it begins JSON output; after output begins, stdout belongs exclusively to JSON.
- A wrapper preserves child output unchanged. If it sanitizes, prefixes, buffers, merges, or reorders child output, it is a transforming wrapper and must document a new stream contract.
- A CI adapter emits its required control records even when they differ from the house style.
- A live stream owns its output channel while active; final human summary belongs on the other channel or after the stream closes.

## Color, Plain Text, and Width

For new commands:

- A non-empty `NO_COLOR` disables automatic color; `NO_COLOR=""` is unset.
- `TERM=dumb` disables ANSI styling and cursor movement.
- `--no-color` disables color only.
- `--plain` disables color, animation, cursor movement, decorative glyphs, and width-dependent reflow.
- Evaluate stdout and stderr TTY capability separately.
- Never emit ANSI in JSON, JSONL, or other machine output.

Use ANSI 8-color roles when a renderer supports them: cyan for headings, `Working`, and `Info`; green for `Success`; yellow for `Warning`; red for `Error`; magenta for active prompt focus. A renderer without ANSI renders the same text without color; it must not substitute another semantic color.

Measure display cells, not bytes. Strip ANSI before measuring. Clamp untrusted width values such as `COLUMNS` to `20..500`. Use stacked fields and record blocks below 48 columns or when width is unknown. Render a table only when every column fits without wrapping; otherwise use record blocks. Never truncate the only exact copy of an ID, URL, path, hash, or command.

Escape control characters in user-provided, file, and remote text before human rendering. Do not interpolate untrusted text into a suggested shell command or instruction. This rule applies only to text rendered by this command. A transparent wrapper preserves child bytes unchanged; treat child output as a separate trust boundary. Sanitizing child output creates a transforming wrapper and requires an explicit contract.

## Human Role Streams

Use this role-to-stream contract for new human-facing commands:

| Surface | Stream | Persistence |
| --- | --- | --- |
| Context, resolved state, preview | stderr | Stable |
| Prompt and hint | stderr | Interactive |
| Working state | stderr | Transient on TTY; stable milestone otherwise |
| Warning and error | stderr | Stable |
| Query result, empty result, list, table, detail | stdout | Stable |
| Successful mutation result and durable details | stdout | Stable |
| Next action after a stdout result | stdout | Stable |
| Live records | Documented stream | Stable |

When stdout is reserved for a machine protocol, keep all human-facing surfaces on stderr. Do not claim that stderr progress "replaces" a stdout result; finish progress on stderr, then emit the result on stdout.

## Prompts and Safety

Prompt only when the value is missing, cannot be inferred safely, reduces risk or ambiguity, and a controlling terminal is available. If stdin is pipe payload, it is not prompt input; fail with the exact missing flag, argument, file, or payload field rather than consuming the pipe.

Every prompt needs a documented non-interactive alternative.

Plain mode has no cursor-driven selection. Use numbered line input instead:

```text
Select an OpenCode profile
  1. work      default
  2. personal
  3. fallback

Enter a number [1]:
```

For multi-select, accept comma-separated numbers and show the selected values before confirmation. Do not use `>` focus rows or redraw output in plain mode.

Use these risk tiers:

| Risk | Required behavior |
| --- | --- |
| Low | Explicit invocation is usually enough |
| Moderate | Show target and impact; default confirmation to No |
| Severe | Require exact-target proof or equivalent explicit automation proof |

- Use `--yes` for accepting ordinary confirmation or shown defaults.
- Use `--force` only to override a protection or alter execution semantics.
- Add `--dry-run` only when intended effects can be modeled truthfully.
- Do not suggest blind retry when remote work may still be running or retries could duplicate a mutation.
- State partial completion, recovery, and an inspect path explicitly.

## Help and Compatibility

For new commands, support `-h` and `--help`; `--help` exits `0`. Help should state the purpose, common examples, required values, defaults, accepted values, conflicting flags, stdin support, output formats, and confirmation requirements.

Use conventional long flag names. Reserve short options for common, obvious actions. Prefer named options when multiple positional arguments would be ambiguous.

Before changing a stable CLI, inventory and protect:

- Commands, aliases, flags, and positional grammar
- Stdin behavior and output streams
- Exit codes and signal behavior
- Text record shape, JSON/JSONL fields, ordering, and meanings
- Config files, environment variables, and precedence
- Completion metadata and parser-visible help

Do not assume additive JSON fields or whitespace changes are compatible. Use a versioned or staged migration when required.

## Long-Running Work and Secrets

Use monotonic time for durations and deadlines. Serialize complete machine records from concurrent workers. Throttle non-TTY progress.

Separate prompt cancellation from process interruption:

- Declining a confirmation or escaping a prompt before mutation exits `0`.
- An application-defined cancellation exits only with its documented domain outcome.
- `SIGINT` and `SIGTERM` preserve their signal-derived failure status unless an established public contract explicitly differs.
- Transparent wrappers forward child signals and preserve the child result.
- Before returning from interruption, clear transient rendering and say whether remote work continues.

Do not print secrets in output, errors, debug logs, telemetry, JSON, or suggested commands. Prefer masked prompts, stdin, file input, or secure file descriptors over secret-valued flags.

Full-screen TUIs are outside this skill. They need separate rules for raw mode, alternate screen, resize, focus, and terminal restoration.
