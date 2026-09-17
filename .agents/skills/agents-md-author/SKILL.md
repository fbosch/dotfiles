---
name: agents-md-author
description: Create, review, or refactor AGENTS.md files so they stay minimal and high-signal. Use when asked to write/edit AGENTS.md, trim bloated agent context files, fix stale instructions, reduce token bloat, or audit instruction clarity. Handles minimal root guidance, monorepo scoping, and progressive-disclosure references.
---

# AGENTS.md Author

Create, review, or refactor AGENTS.md files so they stay minimal, stable, and useful. Favor a tiny root file that points to deeper docs when needed.

## Workflow

1. Scan for existing AGENTS.md files and related docs to avoid duplication.
2. Determine scope with the decision tree below.
3. If editing an existing file, apply the audit triage before changing anything.
4. Draft or refactor the scoped AGENTS.md using the Core Keep/Cut Filters.
5. Link detailed guidance with explicit triggers explaining when to read it.
6. Read `references/agents-md-guide.md` when the user asks for wording, templates, or examples, or when you need background or phrasing help. Skip it for routine trimming or reordering.
7. Check that retained paths, commands, and references are current.

## Scope and Precedence

- Follow the active harness's rules for loading, scope, and instruction precedence; do not assume every harness handles AGENTS.md identically.
- Resolve conflicts using that precedence. If equally authoritative rules conflict and intent is unclear, ask rather than silently deleting either.
- Run applicable validation steps from scoped instructions after making changes and before finishing.

## Core Keep/Cut Filters

Apply these filters once per section:

- **Operational value:** Keep guidance that changes an agent's decisions or prevents a demonstrated mistake. Cut discoverable facts unless discovering them is costly or agents repeatedly miss them.
- **Anchoring:** Remove passive mentions of deprecated tools or patterns unless an explicit warning is needed to prevent their use.
- **Surface fit:** Keep always-on safety and stable repo preferences in AGENTS.md. Put mode-specific behavior in agent prompts, and domain/tool/workflow expertise in skills.
- **Maintenance:** Remove stale paths and commands. Replace brittle layout descriptions with capability-level guidance when exact paths are unnecessary.
- **Duplication:** Cut repeated rules and summaries of existing documentation; link the source when the agent needs it.
- **Generated content:** Do not use generated repository summaries as instructions without reviewing each line for operational value.

## What Earns a Line

Examples that can meet the operational-value filter:

- Always-on safety boundaries: git publishing, destructive commands, secrets, fabricated evidence
- Stable user/repo preferences that apply across task modes
- A required package manager that agents otherwise choose incorrectly: `uv` instead of `pip`, `pnpm` instead of `npm`
- Commands with non-obvious required flags: `--no-cache` to avoid false positives from fixture setup
- Landmines: code that looks safe to refactor but isn't (custom middleware that must not be replaced, deprecated modules still imported by production code)
- Non-standard file placement or naming that contradicts framework defaults

Usually omit unless there is a concrete discovery cost or repeated mistake:

- Tech stack, language, or framework summaries
- Directory trees and architecture overviews
- Standard commands the agent already knows (`npm test`, `git commit`)

## Audit Mode (Existing AGENTS.md)

Apply the Core Keep/Cut Filters, then assign each section:

- Keep: guidance that changes decisions or prevents mistakes.
- Cut: content that fails the filters.
- Relocate: useful detail that belongs in a referenced doc, agent prompt, or skill.

Check for missing guidance about observed mistakes or non-obvious required commands; do not fill sections merely to match a template.

## Scope Decision Tree

1. Does the repo contain multiple independent packages/apps?
   - Yes: monorepo rules apply.
   - No: single repo rules apply.
2. For monorepos, does a package have unique tooling or domain rules?
   - Yes: add a package-level AGENTS.md for that package only.
   - No: keep guidance in the root file only.

## Root AGENTS.md Template (default)

Use this minimal format unless the repo already uses another convention. Omit empty sections; add safety boundaries or preferences when they pass the filters.

```markdown
# AGENTS

<One-sentence project description.>

## Package manager
<Only when agents choose incorrectly or discovery is costly.>

## Commands
- <Non-obvious required build or typecheck command and flags>

## References
- <When to read the linked document>: <path>
```

## Progressive Disclosure

- Keep root under a page when possible.
- Place detailed guidance in separate docs rather than expanding the root file.
- If a reference file is long, add a short table of contents to that file.

## Monorepo Guidance

- Root AGENTS.md contains repository-wide constraints, including shared safety boundaries, preferences, and commands.
- Nested AGENTS.md files contain only local differences; do not duplicate root guidance.

## Hazard Register Lifecycle

When an agent trips on something, add guidance that prevents recurrence. Investigate the root cause: confusing code, unclear structure, or a missing linter rule. Once the underlying problem is fixed and the guidance is no longer needed, delete it.
