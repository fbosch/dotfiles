# Verification

Verify observable CLI behavior, not only the styled happy path. Use the smallest relevant test mechanism and inspect real transcripts when practical.

## Test Matrix

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

## Required Transcripts

Review at least the paths the command supports:

1. Simple query
2. Successful mutation
3. Empty result
4. Recoverable error
5. Partial success
6. Destructive confirmation
7. Intentional cancellation
8. Long-running operation
9. Non-interactive missing input
10. Machine-readable success and failure

## Minimum Profile Checks

Run these checks in addition to the changed behavior's focused tests:

| Profile | Minimum checks |
| --- | --- |
| Human workflow | Success, error, cancellation, plain mode, and stream ownership |
| Query or report | Result, empty result, narrow layout, and exact values |
| Filter | Exact stdout bytes, empty input, error stream, and broken pipe |
| Machine protocol | Valid success and failure payloads, TTY-invariant schema, and stdout cleanliness |
| Interactive command | Prompt, no-input failure, piped stdin, and plain numbered fallback |
| Live stream | Record ordering, no spinner interleaving, interruption, and machine parseability when applicable |
| Transparent wrapper | Exact child stdout/stderr, exit status, signals, and no wrapper sanitization |
| CI adapter | Required CI records and absence of incompatible house-style output |
| Stable public CLI | Existing flags, streams, exit codes, and parser/schema fixtures |

## Assertions

Assert the following when applicable:

- Human output uses the canonical status labels and sentence case.
- Detail rows use two-space indentation, local label alignment, and one blank line between phases.
- No emoji, Nerd Font icon, decorative border, or full-width rule appears in persisted human output.
- Success names the completed state; warnings do not masquerade as success.
- Plain output preserves the same words, hierarchy, and order without ANSI or animation.
- JSON and JSONL stdout parse cleanly and contain no status prose, warning, spinner, or ANSI bytes.
- Prompts never consume piped payload stdin.
- Non-interactive failures name the exact required input.
- Single-select and multi-select prompts preserve the canonical focus, selected-state, default, disabled-choice, hint, and wrapping rules.
- Live streams do not interleave with spinner frames or static result tables.
- IDs, URLs, paths, hashes, and commands remain exactly obtainable at narrow widths.
- Terminal control characters in untrusted text cannot forge terminal rows or control sequences.
- Transparent wrappers preserve child stdout, stderr, status, and signal behavior.
- Wrapper-owned text escapes untrusted controls; transparent child output is unchanged.
- Cancellation, error output, and exit status agree.
- Declined prompts exit `0`; `SIGINT` and `SIGTERM` retain signal-derived failure status.

## Review Gates

Reject or fix changes that:

- Add a prompt for an inferred or already-supplied value
- Apply workflow receipts to filters, machine protocols, streams, wrappers, or CI adapters
- Mix prose or decoration into machine stdout
- Rely on color, symbols, spacing, or cursor position for meaning
- Use a progress bar without a reliable denominator
- Animate outside an interactive terminal
- Emit duplicate completed-progress and success lines
- Claim success after a failed owned operation
- Hide partial failure, retry risk, timeout, or remote continuation
- Consume stdin ambiguously as both payload and prompt input
- Change a stable output, flag, exit, config, or schema contract without migration evidence
- Apply a lower profile rule when compatibility, wrapper, CI, machine, or stream ownership takes precedence
- Expose secrets or interpolate untrusted text into commands
- Add renderer dependencies for static output a plain renderer can express

## Renderer Parity

Compare a plain implementation with each enhanced renderer. Capture a golden transcript for each state and assert the same role, text, stream, and persistence:

```text
Working  Checking inputs...
Success  Updated 4 inputs.
```

Enhanced renderers may add controlled focus, selection, color, or transient activity. They must not change outcome wording, stream ownership, exit behavior, machine contracts, option order, selection markers, or plain-mode fallback.
