---
name: ui-writing
description: Write, implement, or review user-facing interface text for buttons, menus, navigation, settings, dialogs, errors, status and progress feedback, empty states, tooltips, help text, and accessibility labels. Apply during UI implementation whenever visible or assistive copy is added or changed, even when wording is not the explicit task. Use platform, component, design-system, and locale conventions only when the target context establishes them. Do not activate for documentation, code comments, internal identifiers, logs, or commit messages unless the task also includes interface copy.
---

# UI Writing

## Workflow

1. Identify the target platform, locale, component, project terminology, and requested scope.
2. Inspect the implementation or specification before choosing wording that implies behavior. If the behavior is uncertain, name the missing evidence instead of inventing a replacement.
3. Read the applicable rules in [references/guidelines.md](references/guidelines.md). Read [references/terminology.md](references/terminology.md) when a consequential term distinction is involved.
4. Make focused copy changes. Do not modify behavior or rename APIs, configuration keys, localization identifiers, or other internal identifiers.
5. Preserve compliant wording. Do not perform an unrelated consistency sweep.
6. Validate affected localization structures and run relevant existing checks when available.
7. Report material wording changes with their rule identifiers.

## Resolve conflicts

Apply this order:

1. Preserve behavioral accuracy, accessibility requirements, and locale correctness.
2. Respect explicit project terminology and intentional platform decisions. Flag a genuine conflict instead of silently overriding it.
3. Prefer specific component, platform, and locale guidance over general editorial preferences.
4. Treat glossary observations as supporting evidence only.

Do not apply one platform's or locale's conventions to another by default. Use external lookup only when the maintained references and project evidence do not resolve a material question.

## Review-only output

List actual defects separately from optional editorial preferences. Use this table for proposed changes:

| Location | Current text | Proposed text | Rule | Reason |
| -------- | ------------ | ------------- | ---- | ------ |

`No changes needed` is a valid result. Do not rewrite correct copy merely to produce findings.

## Completion checks

- Confirm each changed label still describes the implemented action, state, or consequence.
- Confirm accessible names and visible labels remain aligned.
- Confirm placeholders, plural and select branches, markup, identifiers, product names, and language-specific characters remain intact.
- Report unresolved behavior or locale questions as gaps, not confident wording recommendations.
