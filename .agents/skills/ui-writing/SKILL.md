---
name: ui-writing
description: Write, implement, or review visible and assistive interface text, including labels, navigation, settings, dialogs, errors, progress, empty states, help, and accessibility copy. Apply whenever UI copy changes; not for documentation, comments, logs, internal identifiers, or commit messages.
---

# UI Writing

## Workflow

1. Identify the target platform, locale, component, project terminology, and requested scope.
2. Inspect the implementation or specification before choosing wording that implies behavior. If the behavior is uncertain, name the missing evidence instead of inventing a replacement.
3. Read the applicable rules in [references/guidelines.md](references/guidelines.md). Read [references/terminology.md](references/terminology.md) when a consequential term distinction is involved.
4. Resolve consequential operation terms from the verified effect before drafting. If the source verb conflicts with that effect, replace it; for example, use `Remove` when an item leaves only the named scope and remains available elsewhere.
5. Classify each control's semantics before naming it. An ordinary button without a state API must name the action available now, not the current state. A toggle with `aria-pressed` or equivalent state semantics keeps a stable setting name while the state API communicates on or off.
5. Before proposing a change, identify the behavioral, accessibility, locale, component, or material clarity defect supported by project evidence or an applicable rule. A valid alternative is not evidence that the current wording is defective.
6. Make focused copy changes. Do not modify behavior or rename APIs, configuration keys, localization identifiers, or other internal identifiers.
7. Preserve compliant wording. Treat explicit statements that copy matches the implementation as evidence unless stronger project evidence contradicts them. Do not perform an unrelated consistency sweep.
8. Validate affected localization structures and run relevant existing checks when available.
9. Report material wording changes with their rule identifiers.

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

- For every proposed change, name the concrete defect and supporting evidence or rule. Remove proposals justified only by another valid preference, such as wording that merely sounds more natural or clearer.
- Confirm each changed label still describes the implemented action, state, or consequence.
- Confirm accessible names and visible labels remain aligned.
- Confirm placeholders, plural and select branches, markup, identifiers, product names, and language-specific characters remain intact.
- Report unresolved behavior or locale questions as gaps, not confident wording recommendations.
- When only an error's failed operation is known, output one sentence stating that failure. Omit causes, safety, recovery, retry, timing, and statements that those facts are unknown or unverified.
