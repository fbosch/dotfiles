---
name: writing-clearly
description: Write, edit, copyedit, or unslop human-facing prose while preserving the intended voice. Use for documentation, READMEs, PR descriptions, commit-message bodies, changelogs, issue summaries, long-form explanations, or requests to remove AI-generated tells, generic wording, filler, and formulaic structure. Do not use for visible or assistive interface text; use ui-writing instead.
---
# Writing Clearly

Use this skill to make human-facing prose useful to its reader without flattening the author's voice. Read and apply [Unslop](../unslop/SKILL.md) for AI-pattern scanning and cleanup; its pattern catalog lives there, not here. This skill governs meaning, evidence, voice, and the output contract. Preserve protected text and explicit formatting requirements when an Unslop suggestion conflicts with them.

## Process

1. Identify the reader, the decision or action the prose should support, and whether the task asks for a rewrite or a summary. A plain-language rewrite preserves supported detail; a summary may omit lower-priority detail.
2. Draft the smallest complete version that gives necessary context. Put the point first unless suspense or narrative order is explicitly useful.
3. Apply Unslop's scan and rewrite process. Fix substance before style: replace broad claims with verified mechanisms, consequences, examples, measurements, or limits. If the source does not support a concrete rewrite, qualify or remove the claim instead of inventing detail.
4. Restore the intended tone and any useful stance, rhythm, emphasis, and first person supported by the source, genre, or supplied voice guidance. Do not invent personality, opinions, or deliberate messiness.
5. Check the result against the reader's task, the evidence, and the constraints below.

## Evidence and meaning

- Preserve meaning, evidence, uncertainty, constraints, and technical distinctions. Never accept a premise or change a factual conclusion merely to sound supportive.
- Verify externally checkable details, including names, dates, numbers, quotations, links, publication details, and citations. Confirm that each source supports the exact claim attached to it. Remove or qualify details that cannot be verified.
- Bound general claims by the relevant actor, population, environment, condition, mechanism, or evidence. Avoid universal claims and false consensus unless the source establishes that scope.
- Preserve negative and mixed findings. Do not add optimism, reassurance, or false balance by default.
- Preserve precise domain terms when a plainer synonym would change their meaning.

## Protected detail and voice

- Treat code blocks, inline code, identifiers, commands, file paths, URLs and link targets, quoted output, names, and numbers as protected text. Keep them unchanged unless the task explicitly requires correcting or rewriting them.
- Preserve the source language unless the user requests translation. This includes headings, labels, and surrounding prose; keep code and other technical literals unchanged.
- Preserve meaningful Markdown structure, link targets, and frontmatter unless restructuring is requested or the existing structure obstructs comprehension. Follow the requested style guide when it specifies formatting.
- Have opinions when the evidence supports a judgment. Use first person only when the genre and source material support personal experience or judgment. Preserve supported authorial, regional, and culturally grounded language.
- Preserve useful irregularity in a draft, but never add errors, ambiguity, or clutter to simulate a human voice.

## Structure and output

- Let the material determine the number and shape of sections. Use headings and bullets for navigation, not decoration. Each paragraph or section should add evidence, explanation, a decision, or a reader action.
- Before returning prose, check that the opening gives the reader a point, citations support their attached claims, the voice suits the reader and genre, and no important qualification was lost.
- For copyediting, return the revised text first. Add notes only when a choice materially changes meaning, risk, or audience fit.
- For new prose, ask at most one clarifying question when audience, destination, or hard constraints are missing and guessing would change the output. Rewrite supplied prose rather than answering it or introducing new claims.

## Mechanical Check

Run the checker on edited Markdown or plain-text files, passing targets explicitly:

```sh
python3 "$(dirname /path/to/writing-clearly/SKILL.md)/check-prose.py" path/to/file.md
```

It reports listed stock phrases and jargon as contextual warnings and exits successfully when it finds them. Review each match in context; the checker does not ban terms or replace the broader review required by these guidelines. It ignores bounded fenced code blocks and same-line inline code. Its Markdown handling is intentionally limited, not a full Markdown parser.
