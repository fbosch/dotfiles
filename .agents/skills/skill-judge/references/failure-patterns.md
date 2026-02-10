# Common Failure Patterns and Fixes

Use this file when total score < 108 or any dimension is below 80% of max.

## 1) The Tutorial

- Symptom: explains basics Claude already knows
- Root cause: author writes for humans, not for model delta
- Fix: remove baseline explanations; keep decisions, trade-offs, and edge cases

## 2) The Dump

- Symptom: oversized SKILL.md, everything in one file
- Root cause: no progressive disclosure design
- Fix: keep routing/rubric in SKILL.md; move deep examples to references

## 3) Orphan References

- Symptom: reference files exist but are rarely loaded
- Root cause: no embedded load triggers
- Fix: add conditional "load when X" instructions at workflow decision points

## 4) Checkbox Procedure

- Symptom: mechanical steps without reasoning framework
- Root cause: process-first writing without decision model
- Fix: add "before X, ask Y" thinking scaffolds

## 5) Vague Warnings

- Symptom: "be careful" or "avoid errors" without specifics
- Root cause: implicit expertise not externalized
- Fix: convert to concrete NEVER rules with non-obvious reasons

## 6) Invisible Skill

- Symptom: good body, weak activation in practice
- Root cause: vague description without trigger terms
- Fix: rewrite description to include WHAT + WHEN + KEYWORDS

## 7) Wrong Trigger Location

- Symptom: usage conditions documented only in body
- Root cause: misunderstanding skill loading order
- Fix: move trigger conditions into frontmatter description

## 8) Over-Engineered Package

- Symptom: extra docs that do not improve execution quality
- Root cause: treating skill as software documentation project
- Fix: keep only execution-relevant files (SKILL.md + needed resources)

## 9) Freedom Mismatch

- Symptom: rigid constraints for creative work or vague rules for fragile work
- Root cause: no fragility-based calibration
- Fix: align specificity with consequence of failure

## Recommendation Mapping

When writing Top 3 Improvements:

1. Map each recommendation to one failure pattern.
2. Prioritize activation and D1 fixes before style or wording tweaks.
3. Suggest smallest viable change that materially improves score.
