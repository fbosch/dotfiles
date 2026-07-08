# opencode-handoff

OpenCode plugin for continuing work in a fresh session without losing the useful parts of the previous one.

Inspired by Amp's handoff command: [post](https://ampcode.com/news/handoff), [manual](https://ampcode.com/manual#handoff).

## What It Adds

- `/handoff <goal>` creates a focused continuation prompt from the current conversation.
- The prompt can include relevant `@file` references for the next session.
- A new session opens with the generated prompt as an editable draft.
- `read_session` lets the next session fetch the original transcript when the summary is not enough.

## Requirements

- OpenCode v1.2.15 or later.
- Bun for local typechecking and development.

## Install

Add the plugin to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-handoff@0.5.0"]
}
```

Pinning avoids startup-to-startup changes from an unpinned npm plugin.

## Usage

Run the command with the next session's goal:

```text
/handoff implement the user authentication feature we discussed
```

The new session gets a prompt draft. Review it before sending if the current conversation had noisy or sensitive context.

Generated prompts include a source session reference, for example:

```text
Continuing work from session sess_01jxyz123. When you lack specific information you can use read_session to get it.
```

That reference is enough for the next session to call `read_session` when it needs exact earlier details.

## Development

```bash
bun install
bun run typecheck
```

The package exports `handoff.ts` and expects `@opencode-ai/plugin` as a runtime peer supplied by OpenCode.
