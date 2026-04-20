---
name: agents-md-author
description: Create, review, or refactor AGENTS.md files so they stay minimal and high-signal. Use when asked to write/edit AGENTS.md, trim bloated agent context files, fix stale instructions, reduce token bloat, or audit instruction clarity. Handles minimal root guidance, monorepo scoping, and progressive-disclosure references.
---

# AGENTS.md Author

Create, review, or refactor AGENTS.md files so they stay minimal, stable, and useful. Favor a tiny root file that points to deeper docs when needed.

## Workflow

1. Scan for existing AGENTS.md files and related docs to avoid duplication.
2. Determine scope with the decision tree below.
3. If editing an existing file, audit it before changing anything.
4. Draft or refactor the root AGENTS.md with only the essential content.
5. Add references to deeper docs for any detailed rules or workflows.
6. If the user asks for wording, templates, or examples, read `references/agents-md-guide.md` before drafting.
7. Validate for staleness and token budget:
   - Apply the filters in **Core Keep/Cut Filters** below.

## Scope and Precedence

- An `AGENTS.md` file applies to the directory tree rooted at the folder that contains it.
- For any file you touch, follow every `AGENTS.md` whose scope includes that file.
- More deeply nested `AGENTS.md` files override broader ones when they conflict.
- Direct system, developer, and user instructions override `AGENTS.md`.
- If a scoped `AGENTS.md` or referenced workflow doc specifies validation steps, run them after making changes and before finishing.

## Mindset Checks (Before Editing)

- Will this change improve activation or execution safety, or just add noise?
- Is the guidance stable for 6+ months, or will it drift?
- Is this better as a reference doc instead of in the root file?
- Can the agent discover this directly from code or standard tooling? If yes, leave it out.
- Does mentioning this anchor the agent toward a deprecated or wrong pattern? Every line competes for attention and biases behavior — even passive mentions.
- Will this line become redundant as the underlying friction gets fixed or as models improve?

## Core Keep/Cut Filters

Apply these filters once per section and avoid re-litigating the same rule elsewhere:

- **Discoverability (primary gate):** Remove anything the agent can find by reading code, config, READMEs, or running standard commands. Tech stack descriptions, architecture overviews, directory structures, and framework conventions are all discoverable — cut them.
- **Anchoring:** Remove passive mentions of tools, patterns, or modules that could bias the agent toward deprecated or wrong approaches. If you mention it, the agent treats it as current and relevant.
- Remove brittle paths, long lists, or duplicated guidance.
- Keep instructions high-level and stable.
- Keep build/validation notes only when they are non-standard or easy to miss.
- Remove guidance once the underlying friction is fixed.

## What Earns a Line

A line belongs in AGENTS.md only if it passes the discoverability gate: the agent cannot infer it from the codebase, and it is operationally significant. Concrete examples:

- Non-standard package manager: `uv` instead of `pip`, `pnpm` instead of `npm`
- Commands with non-obvious required flags: `--no-cache` to avoid false positives from fixture setup
- Landmines: code that looks safe to refactor but isn't (custom middleware that must not be replaced, deprecated modules still imported by production code)
- Non-standard file placement or naming that contradicts framework defaults

Does NOT earn a line:

- Tech stack, language, or framework (discoverable from package.json, imports, config)
- Directory structure or module layout (discoverable from ls)
- Architecture overviews or design patterns (discoverable from code)
- Standard commands the agent already knows (`npm test`, `git commit`)

## Audit Mode (Existing AGENTS.md)

Use this checklist to review and edit existing files:

- Token bloat: remove long lists, verbose explanations, or duplicated guidance.
- Discoverable content: cut facts the agent can infer from codebase/tooling.
- Stack overviews: remove language/framework summaries unless they are actionable constraints.
- Stale details: remove paths, file trees, or commands that drift.
- Missing triggers: ensure the file explains WHEN to use referenced docs.
- Clarity: keep instructions short, stable, and action-oriented.
- Gaps: add missing package manager or non-standard commands.

Apply a triage pass to each section:

- Keep: stable, high-value guidance.
- Cut: redundant or brittle content.
- Relocate: move detail into a referenced doc.

## Scope Decision Tree

1. Does the repo contain multiple independent packages/apps?
   - Yes: monorepo rules apply.
   - No: single repo rules apply.
2. For monorepos, does a package have unique tooling or domain rules?
   - Yes: add a package-level AGENTS.md for that package only.
   - No: keep guidance in the root file only.

## Root AGENTS.md Template (default)

Use this minimal format unless the repo already uses another convention:

```markdown
# AGENTS

<One-sentence project description.>

## Package manager
<Only when non-standard or not reliably discoverable from repo tooling.>

## Commands
- <Non-standard build or typecheck commands>

## References
- <Link to deeper docs when needed, e.g., docs/TYPESCRIPT.md>
```

## Progressive Disclosure

Use references for details rather than expanding the root file:

- Keep root under a page when possible.
- Place domain-specific guidance in separate docs.
- Reference those docs from root with short, stable pointers.

If a reference file is long, add a short table of contents to that file.

Do NOT load reference docs for routine edits that only trim or reorder content.

## Monorepo Guidance

- Root AGENTS.md: repo-wide description and shared commands only.
- Package AGENTS.md: local package context and package-specific commands.
- Avoid duplicating root guidance in package files.

## Anti-Patterns (Never Do)

- Never copy README content into AGENTS.md; it bloats context and dilutes activation.
- Never include deep file trees or path lists; they rot quickly and poison context.
- Never include codebase structure or tech stack overviews that code already reveals.
- Never add broad, absolute rules unless they are critical and stable.
- Never auto-generate AGENTS.md. Auto-generated output duplicates what agents already discover from the repo, adds ~20% cost overhead, and can reduce task success — because the agent reads the file, then re-discovers the same facts from code, and must reconcile two sources of truth.
- Never include setup steps that already live in standard tooling docs.

## Expert Heuristics

- If AGENTS.md exceeds one page, cut to essentials and move detail into references.
- If two rules conflict, keep the more stable and delete the more brittle one.
- If a rule depends on file layout, replace it with a capability-level description.
- **Hazard register lifecycle:** When an agent trips on something, add a line. Then investigate the root cause — is the code confusing, the structure unclear, the linter missing a rule? Fix the underlying problem. Once fixed, delete the line. The file should shrink as the codebase improves.
- **Temporal decay:** AGENTS.md should shrink over time, not grow. Instructions that were essential months ago may be redundant now as models improve at codebase navigation. Audit for lines that no longer earn their place.

## Output Expectations

- Use ASCII unless the repo already uses other characters.
- Do not auto-generate AGENTS.md with init scripts.
- Prefer stability over detail; cut anything that will drift.

## Resources

Read this guide when you need more background or phrasing help:

- `references/agents-md-guide.md`
