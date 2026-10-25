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

- When a concept, relationship, timeline, hierarchy, or quantitative comparison would be easier to grasp visually, use `chart_*` tools for data, results, and quantitative visualizations; use Mermaid diagrams mainly for flows and process relationships. Include a concise textual explanation too.
- Preserve Danish letters exactly (`æ`, `ø`, `å`).
- Treat follow-up requests as cumulative unless the user resets scope.
- Target the current contract. Add compatibility paths only for explicitly scoped
  persisted data or external consumers.
- Test the current contract, not deletion history. When removing a feature,
  remove obsolete tests and update affected coverage for remaining behavior.
  Do not replace presence checks with absence checks solely to record removal;
  no replacement test is required. Keep negative assertions only for explicit
  ongoing requirements, such as security prohibitions or scoped compatibility
  or migration contracts. Preserve coverage of supported behavior; never delete
  tests merely to silence unexplained failures.
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

## Conditional guidance

- Before selecting or adding a dependency, library, or development tool, read
  `~/.pi/agent/references/library-preferences.md`. If several suitable options
  remain and the repository establishes none, ask before choosing one for
  implementation.
- Before changing behavior, APIs, configuration formats, data handling, or
  validation paths, read `~/.pi/agent/references/compatibility.md`.
- Before running or reporting validation, read
  `~/.pi/agent/references/validation.md`.
- When a prompt or agent definition names a skill, resolve the advertised skill path first when one is available. If it is not advertised, use the documented canonical roots, such as `~/.agents/skills/<skill-name>/SKILL.md` or the repository's `.agents/skills/`, `.pi/skills/`, and `.opencode/skills/` paths as applicable. Follow mirrors only after identifying the canonical source.
- For worktree operations, use `wt`. Do not run mutating `git worktree` commands
  directly. Inspect with `wt list` or `wt status` before an explicitly authorized
  `wt remove`.

## Communication

These rules apply to conversational replies, progress updates, questions, and
handoffs. Writing skills apply to artifacts, not ordinary agent communication:
use `writing-clearly` for substantial prose artifacts and `ui-writing` for
interface copy.

- Be direct, concise, and technical. Do not add praise, apologies, or optional
  closing offers.
- Lead with the answer, result, or decision needed. Include the reasoning that
  makes it useful, without narrating routine work.
- Optimize for unambiguous meaning, not minimum word count. Keep necessary
  conditions, exceptions, and context.
- Use consistent names for the same concept. Preserve technical distinctions
  and exact identifiers rather than rotating synonyms.
- Prefer active voice and concrete verbs. Name the actor when ownership
  matters, and replace ambiguous pronouns with the thing they refer to.
- Split dense sentences when they combine distinct ideas. Do not compress
  explanations into fragments that the reader must decode.
- Format user-executed multi-step instructions as a numbered list, with one
  action per step. Put prerequisites and warnings before the affected action.
  Otherwise, start with the immediate action.
- Preserve uncertainty and requirement strength. Do not turn "may" into
  "will", "should" into "must", or a possible cause into a confirmed cause.
- Distinguish observations, inferences, and recommendations. State what remains
  unknown when it affects the conclusion or next action.
