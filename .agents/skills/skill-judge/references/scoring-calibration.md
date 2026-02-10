# Scoring Calibration

Use this file when a score is borderline or evaluator confidence is mixed.

## Tie-Break Procedure

1. Pick provisional lower score.
2. Gather evidence for higher score.
3. Promote only if there are 2+ independent evidence points.
4. If evidence conflicts, keep lower score and note ambiguity.

## Boundary Examples

### D1: Knowledge Delta (15 vs 16)

- Score 15 if expert content is strong but repeated principles inflate tokens.
- Score 16 only when almost every section contributes non-obvious value.

### D4: Specification (13 vs 14)

- Score 13 if description has WHAT but weak WHEN or missing trigger terms.
- Score 14 when description clearly states WHAT + WHEN + KEYWORDS and supports reliable activation.

### D5: Progressive Disclosure (10 vs 11)

- Score 10 if references exist but load triggers are generic.
- Score 11 when conditional load guidance is embedded in workflow steps.

### D8: Practical Usability (13 vs 14)

- Score 13 for strong common-case guidance with thin fallback detail.
- Score 14 when fallback paths are explicit and edge cases are addressed.

## Cross-Dimension Sanity Checks

- If D1 is low and D8 is very high, verify the skill is not merely procedural.
- If D4 is low, surface activation risk even when body quality is high.
- If D5 is low for a long skill, recommend split into references before stylistic edits.

## Confidence Annotation

If uncertainty remains after tie-break:
- keep the lower score
- mention uncertainty source in Notes
- recommend targeted follow-up evidence
