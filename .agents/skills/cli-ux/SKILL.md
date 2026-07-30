---
name: cli-ux
description: Design, implement, refactor, or review line-oriented command-line interfaces across any language or renderer. Use when changing commands, flags, help, prompts, confirmations, progress, errors, warnings, results, lists, tables, output layout, colors, stdout/stderr, machine formats, TTY behavior, non-interactive behavior, destructive actions, streams, wrappers, or CLI compatibility. Do not use for internal refactors with no observable CLI change or for full-screen terminal UIs.
---

# CLI UX

Create clear, scriptable line-oriented CLIs with one exact human-output style.
Treat Fish, shell, Gum, Clack, Rich, Charmbracelet, Cobra, Click, and plain ANSI as renderers. Choose the smallest renderer that fits the interaction; do not let a renderer define the visible design.

## Classify First

Classify each command or subcommand before changing its output. A command can have more than one profile.

| Profile | Primary contract |
| --- | --- |
| Human workflow | Guided task completion |
| Query or report | Scannable human result |
| Filter | Exact transformed records |
| Machine protocol | Stable documented data |
| Interactive command | Prompt and selection flow |
| Live stream | Ordered ongoing records |
| Transparent wrapper | Preserve child behavior |
| CI adapter | Preserve CI control protocol |
| Stable public CLI | Preserve compatibility |

Answer before implementation:

1. Who consumes stdout and stderr?
2. Is stdin payload, prompt input, or unused?
3. Is output already a stable text or machine protocol?
4. Does a child process own either stream or the terminal?
5. Which modes exist: TTY, pipe, CI, no-input, plain, JSON, JSONL?
6. Which compatibility contracts must remain unchanged?

## Workflow

1. Identify the user job, target, side effects, failure states, and recovery path.
2. Map every observable surface: context, resolved state, prompt, preview, progress, result, warning, error, empty state, list, detail, stream, and machine record.
3. Draft the intended plain-text transcript before choosing a renderer.
4. Load only the reference required for the changed surface.
5. Implement semantic output before color, animation, or library-specific controls.
6. Test the relevant matrix in [verification.md](references/verification.md).
7. Review the complete before/after transcript, not only edited strings.

## Reference Routing

Choose the lowest numbered matching row. Do not combine lower-priority rows after choosing one.

| Priority | Change | Required references |
| --- | --- | --- |
| 1 | Prompt, destructive action, or any change affecting both presentation and behavior | All three references |
| 2 | Visual implementation or review with unchanged streams, modes, and contracts | `visual-language.md` + [verification.md](references/verification.md) |
| 3 | Stream, mode, safety, signal, compatibility, or other behavioral implementation or review with unchanged human presentation | [behavior.md](references/behavior.md) + `verification.md` |
| 4 | Advisory copy or layout draft with no source change | `visual-language.md` |

Every implementation or review loads `verification.md` and runs the minimum checks for every applicable profile.

## Non-Negotiables

- Design the command journey, not isolated strings.
- Make human output useful without breaking composition and automation.
- Treat interaction, format, decoration, and verbosity as separate axes.
- Ask only for unresolved input; never require a prompt.
- Show meaningful state transitions, but omit phases that add no information.
- Scale confirmation strength to the consequence of the action.
- Print enough for slow work and state changes, but not developer-only detail by default.
- Make errors explain the failure and the safest next action.
- Treat command grammar, streams, exit codes, and machine output as APIs.
- Treat secrets and remote or user-provided text as untrusted data.
- Preserve compatibility over visual consistency for an established public contract.

## Completion Check

Before considering a CLI change done, answer:

- What target did the command resolve?
- What will it change?
- What happened?
- What can the user or caller do next?

Filters, machine protocols, live streams, wrappers, CI adapters, and no-op queries may intentionally omit some answers. Do not force workflow output onto them.

## Source Basis

This original synthesis is informed by the [Command Line Interface Guidelines](https://clig.dev/) and Vercel's [CLI UX skill](https://github.com/vercel/vercel/tree/main/packages/cli/.agents/skills/cli-ux). It deliberately does not reuse their product vocabulary, branded glyphs, helper APIs, or command contracts.
