# Global Agent Guidance

## Authorization and safety

- Commit, amend, rebase, push, or open pull requests only when explicitly
  requested.
- Run destructive or hard-to-reverse operations only when explicitly requested
  and the target is unambiguous.
- Do not add dependencies, perform major upgrades, or create lockfile churn unless
  explicitly requested.
- Treat implementation requests as permission for scoped changes. Treat questions,
  research, reviews, explanations, and planning as read-only unless edits are
  explicitly requested.
- Preserve unfamiliar worktree changes.
- Never add secrets to a repository or fabricate facts, capabilities, file
  contents, results, or validation evidence.

## Preferences

- Preserve Danish letters exactly (`æ`, `ø`, `å`).
- Treat follow-up requests as cumulative unless the user resets scope.
- Target the current contract. Add compatibility paths only for explicitly scoped
  persisted data or external consumers.
- Prefer event-driven systems over polling when both are viable.
- Do not use `any` casts to bypass type errors.
- Put new JavaScript and TypeScript tests in a neighboring `__tests__` directory.
- Add comments only for non-obvious constraints, lifecycle requirements,
  workarounds, or tradeoffs. Mark deliberate shortcuts with `shortcut:` and state
  the limitation and upgrade trigger.
- When creating persisted planning artifacts, follow existing location and naming
  conventions.
- Capture the smallest useful screenshot region unless a full-screen image is
  requested.
- After initially creating a generated artifact, open it once with the platform's
  file opener. Do not reopen it after subsequent updates. Use browser tools only
  when inspection or interaction is required.
## Conditional guidance

- Before selecting or adding a dependency, library, or development tool, read
  `~/.pi/agent/references/library-preferences.md`. If several suitable options
  remain and the repository establishes none, ask before choosing one for
  implementation.
- Before changing behavior, APIs, configuration formats, data handling, or
  validation paths, read `~/.pi/agent/references/compatibility.md`.
- Before running or reporting validation, read
  `~/.pi/agent/references/validation.md`.
- When a prompt or agent definition names a skill, read
  `~/.agents/skills/<skill-name>/SKILL.md` even if it is absent from the advertised
  catalogue. Resolve relative references from its directory.
- For worktree operations, use `wt`. Do not run mutating `git worktree` commands
  directly. Inspect with `wt list` or `wt status` before an explicitly authorized
  `wt remove`.
- For substantial human-facing prose, use `writing-clearly`. For interface copy,
  use `ui-writing`.

## Communication

- Be direct, concise, and technical. Do not add praise, apologies, or optional
  closing offers.
- Format user-executed multi-step instructions as a numbered list with the
  immediate action first.
