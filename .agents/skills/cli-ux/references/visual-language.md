# Visual Language

Apply this exact house style to human-facing, line-oriented CLI output. It applies equally to plain `printf`, Fish, Gum, Clack, Rich, and other renderers.

## Surfaces

Assign every visible item one role: context, resolved state, prompt, prompt hint, preview, working state, info, success, warning, error, empty state, list, table, detail, diff, live stream, or next action. Do not combine roles on one line.

## Transcript Structure

Use this order when the command needs each phase:

```text
Context

Resolved state
Decision or confirmation

Planned change
Working state

Result
Durable details
Next action
```

Omit phases that do not change a decision or confirm a result. Use one blank line between logical phases, no blank line inside a related block, and no leading or trailing blank line.

## Status Lines

Use these exact labels in a seven-character column followed by two spaces:

```text
Working  Checking 12 inputs...
Info     No cached result found.
Success  Updated 4 inputs.
Warning  Updated 3 of 4 repositories.
Error    Failed to rebuild the system.
```

- Bold and color only the label.
- Use ANSI cyan for `Working` and `Info`, green for `Success`, yellow for `Warning`, and red for `Error`; see [behavior.md](behavior.md#color-plain-text-and-width) for renderer fallback.
- Keep the message in the default foreground.
- Preserve labels in plain output.
- Do not use emoji, Nerd Font icons, checkmarks, or log abbreviations.
- State what changed. Never use `Done!`, `Success!`, or `Completed successfully`.

For a plain diagnostic or transparent wrapper, use `command-name: message` instead of a status line. Do not combine both forms.

## Type and Color

| Role | Style |
| --- | --- |
| Heading | Bold cyan |
| Status label | Bold semantic color |
| Prompt focus | Bold magenta |
| Metadata and hints | Dim default foreground |
| Command, path, ID | Bold default foreground |
| Link | Cyan; underline only when supported |
| Value | Default foreground |

Do not color paragraphs, assign arbitrary colors to records, use red for an unselected option, or use green only to mean selected. Color must reinforce text, not replace it.

## Headings and Detail

Use bold cyan sentence-case headings only for multi-line output:

```text
OpenCode profile
  Profile  work
  Model    openai/gpt-5.4
  Updated  2026-07-30 14:32
```

- Do not append punctuation, center headings, add borders, or use decorative rules.
- Indent detail rows by two spaces.
- Use title-case labels without colons.
- Align labels within one block only. Cap the label column at 16 display cells.
- Stack fields below 48 columns or when width is unknown:

```text
OpenCode profile
  Profile
    work
  Model
    openai/gpt-5.4
```

## Lists and Tables

Use two-space-indented hyphen lists:

```text
Available profiles
  - work      active
  - personal  3 resets available
  - fallback  unavailable
```

Use borderless tables only to compare repeated records:

```text
Daemon          Status   PIDs
Window state    running  1421
Window capture  stopped  -
```

- Use one header row and no outer border.
- Left-align text; right-align numeric columns only when comparison benefits.
- Prefer fewer columns over wrapping.
- Use `-` for compact unavailable values.
- Fall back to record blocks below 48 columns or whenever columns would wrap.

## Empty, Error, and Next States

Use factual empty states:

```text
Info     No profiles found.
```

Add at most one next action:

```text
Info     No cached update data found.
  Run `tool refresh` to create it.
```

Render recoverable errors in order of failure, cause, recovery:

```text
Error    Failed to update the system.
  `nix flake update` exited with status 1.
  Run `tool status` before retrying.
```

Put the safest actionable instruction last. Do not show stack traces or raw upstream objects outside explicit debug mode.

## Progress and Results

Use an activity indicator only for active indeterminate work:

```text
Working  Checking flake inputs...
```

Use a progress bar only with a reliable current and total:

```text
Working  Uploading files  37/80
```

Replace transient progress with one final result:

```text
Success  Uploaded 80 files.
```

- Use present participles for working text and past tense for results.
- Do not invent percentages.
- Do not place a spinner over a live stream.
- Do not retain a completed spinner plus duplicate success output.
- Use stable milestones instead of animation in non-TTY output.

For partial work, use `Warning`, not `Success`:

```text
Warning  Updated 3 of 4 repositories.
  Failed: `~/src/example`
```

## Prompts and Confirmation

Ask for one concrete concept:

```text
Select an OpenCode profile
  Current  work
```

For selection controls, show a muted key hint:

```text
Select flake inputs to update
  Space selects; Enter confirms.
```

Render a single-select prompt with these exact rows:

```text
Select an OpenCode profile
  Current  work

  > work
    personal
    fallback
```

Render a multi-select prompt with these exact rows:

```text
Select flake inputs to update
  Space selects; Enter confirms.

  > [x] nixpkgs
    [ ] home-manager
    [x] hyprland
```

- `>` identifies the focused choice; do not color it without preserving this marker.
- `[x]` identifies a selected choice and `[ ]` an unselected choice.
- Prefix disabled choices with `-` and explain the reason on an indented muted line.
- Mark a default with `default` after two spaces, not with a different glyph.
- Wrap long choice descriptions beneath the option with four-space indentation.
- Enhanced renderers may decorate only the transient focus row while active. Their option order, selected-state markers, hints, wrapping, streams, and final text must match these transcripts.

Show defaults and resolved state before asking. Avoid `Do you want to...` and `Would you like to...`.

Use direct confirmations:

```text
Update 4 selected inputs? [y/N]
```

For severe actions, show target and consequence, then require exact proof:

```text
Delete project `example`
  This deletes its deployments and cannot be undone.

Type `example` to continue:
```

Declining a confirmation or escaping a prompt before mutation exits `0`. Print `Info     Cancelled.` only when silence would be ambiguous. Signal interruption is not prompt cancellation; follow [behavior.md](behavior.md#long-running-work-and-secrets).

## Copy

- Use sentence case, active voice, numerals, exact names, and one canonical verb per action.
- Keep commands, flags, paths, IDs, and literals exact and copyable.
- Use `...` for ongoing text; do not require Unicode ellipses.
- Avoid hype, apology preambles, humor in errors, generic failure prose, and routine exclamation marks.
- Use `create`, `add`, `remove`, `delete`, `disconnect`, and `revoke` precisely. Match the completion verb to the requested action.
