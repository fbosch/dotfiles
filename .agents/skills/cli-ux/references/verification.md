# Verification

Verify observable CLI behavior, not only the styled happy path. Use the smallest relevant test mechanism and inspect real transcripts when practical.

## Test Matrix

Select supported cases from this matrix, including the minimum checks for each applicable profile below.

| Concern | Cover |
| --- | --- |
| Destination | stdout TTY, stderr TTY, redirected output, pipe |
| Interaction | Interactive, non-interactive, no controlling terminal |
| Format | Human, plain, JSON, JSONL |
| Decoration | Default, `--no-color`, `NO_COLOR`, `TERM=dumb` |
| Outcome | Success, no-op, empty, cancelled, partial, failed |
| Width | Wide, narrow, unknown, invalid `COLUMNS` |
| Input | argv, piped stdin, file, missing, Unicode, long values |
| Progress | Indeterminate, bounded, non-TTY, live stream |
| Signals | Interrupt, termination, broken pipe |
| Compatibility | Existing invocation, parser, config, stream, and schema |
| Renderer | Plain renderer plus each enhanced renderer in scope |

## Minimum Profile Checks

Run these checks in addition to the changed behavior's focused tests:

| Profile | Minimum checks |
| --- | --- |
| Human workflow | Success, error, cancellation, plain mode, and stream ownership |
| Query or report | Result, empty result, narrow layout, and exact values |
| Filter | Exact stdout bytes, empty input, error stream, and broken pipe |
| Machine protocol | Valid success and failure payloads, TTY-invariant schema, and stdout cleanliness |
| Interactive command | Prompt, destructive confirmation, no-input failure, piped stdin, and plain numbered fallback |
| Live stream | Record ordering, no spinner interleaving, interruption, and machine parseability when applicable |
| Transparent wrapper | Exact child stdout/stderr, exit status, signals, and no wrapper sanitization |
| CI adapter | Required CI records and absence of incompatible house-style output |
| Stable public CLI | Existing flags, streams, exit codes, and parser/schema fixtures |

## Assertions

Assert the following when applicable:

- Human output uses the canonical status labels and sentence case.
- Detail rows use two-space indentation, local label alignment, and one blank line between phases.
- No emoji, Nerd Font icon, decorative border, or full-width rule appears in persisted human output.
- Success names the completed state and is not emitted after a failed owned operation; partial completion, recovery, retry risk, timeout, and remote continuation are explicit.
- Plain output preserves the same words, hierarchy, and order without ANSI or animation; meaning does not depend on color, spacing, or cursor position.
- JSON and JSONL stdout parse cleanly and contain no status prose, warning, spinner, or ANSI bytes.
- Prompts ask only for unresolved input and never consume piped payload stdin.
- Non-interactive failures name the exact required input.
- Single-select and multi-select prompts preserve the canonical focus, selected-state, default, disabled-choice, hint, and wrapping rules.
- Live streams do not interleave with spinner frames or static result tables.
- Progress bars have a reliable denominator; animation stays in interactive terminals, with no duplicate completed-progress and success lines.
- IDs, URLs, paths, hashes, and commands remain exactly obtainable at narrow widths.
- Terminal control characters in untrusted text cannot forge terminal rows or control sequences.
- Transparent wrappers preserve child stdout, stderr, status, and signal behavior; wrapper-owned text escapes untrusted controls while child output is unchanged.
- Cancellation, error output, and exit status agree. Declined prompts exit `0`; `SIGINT` and `SIGTERM` retain signal-derived failure status.
- Filters, machine protocols, streams, wrappers, and CI adapters do not acquire workflow receipts.
- Stable output, flag, exit, config, and schema contracts remain unchanged unless migration evidence supports the change.
- Lower profile rules do not override compatibility, wrapper, CI, machine, or stream ownership.
- Secrets are not exposed and untrusted text is not interpolated into commands.
- Renderer dependencies are not added for static output a plain renderer can express.

## Renderer Parity

Compare a plain implementation with each enhanced renderer. Capture a golden transcript for each state and assert the same role, text, stream, and persistence:

```text
Working  Checking inputs...
Success  Updated 4 inputs.
```

Enhanced renderers may add controlled focus, selection, color, or transient activity. They must not change outcome wording, stream ownership, exit behavior, machine contracts, option order, selection markers, or plain-mode fallback.
