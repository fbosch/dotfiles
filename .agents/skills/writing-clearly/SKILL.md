---
name: writing-clearly
description: Write, edit, copyedit, or unslop human-facing prose while preserving the intended voice. Use for documentation, READMEs, PR descriptions, commit-message bodies, changelogs, issue summaries, long-form explanations, or requests to remove AI-generated tells, generic wording, filler, and formulaic structure. Do not use for visible or assistive interface text; use ui-writing instead.
---
# Writing Clearly

Make human-facing prose useful to its reader without flattening the author's voice. Before drafting or editing, open the `SKILL.md` in the sibling `unslop` directory (one level up from this skill directory). That skill owns the AI-pattern catalog. It is not advertised for automatic activation, so mentioning it is not a substitute for reading it. If it is unavailable, complete the evidence and voice edit but disclose that the AI-pattern audit was not completed.

Genre-specific skills own artifact structure and output contracts; this skill owns the shared prose pass, and Unslop owns pattern detection subject to fidelity. For mixed UI and documentation tasks, use `ui-writing` for visible or assistive text and this skill for prose, not one style rule across both.

## Decide the editorial contract

1. Identify the reader, the decision or action the prose should support, and the requested scope. A rewrite retains supported detail; a summary may omit lower-priority detail. Lead with the point unless narrative order serves the reader.
2. Separate observations and attributed claims from inferences. If supplied evidence contradicts an inference, discard that claim and draft from what the evidence establishes and the relevant unknowns. Do not keep the discarded claim merely to negate it unless that contrast prevents a likely misreading.
3. Distinguish retaining, omitting, and correcting a literal. When retaining text, preserve protected literals exactly. A summary or evidence correction may omit an entire claim and its literals; protection does not require keeping unsupported content. Do not silently change a retained date, number, quotation, or command. If a required literal conflicts with the evidence, ask for a decision instead of guessing.
4. For a copyedit without a fact-checking request, retain source details with their existing attribution and uncertainty if no contrary evidence is supplied. Verify externally checkable details when fact-checking is requested or before introducing a new claim. If verification fails, qualify the claim or state what could not be checked; do not invent corroboration.
5. Draft the smallest complete version from the retained facts, rather than minimally editing an unsupported sentence. Apply Unslop's scan and rewrite process, then restore supported stance, rhythm, emphasis, and first person. Never trade a real caveat for a smoother sentence.

For example, if a draft says `Logs show 3 retries, proving a 50% speedup` but the logs only establish retries, a grounded rewrite can say `Logs show 3 retries; speed was not measured`. Omitting `50%` removes an unsupported claim; changing the observed `3` would alter evidence. A summary may omit both if retries are irrelevant to its purpose.

## Preserve what the source means

- Protect code blocks, inline code, identifiers, commands, paths, URLs and link targets, names, numbers, and quoted text **when retaining them**. Preserve exact words, punctuation, and quote marks of a quotation unless explicitly asked to correct it. Recast the sentence around it: `Mira said "we saw two retries".` may become `Mira reported, "we saw two retries".`, but not `Mira said "we saw two retries."` or `Mira said “we saw two retries”.`.
- Keep technical distinctions and established terms where a plain synonym would change their meaning. Preserve the source language unless translation is requested, including headings and surrounding prose.
- When a draft supplies a link but not the linked document's contents, keep the target and use only a supported label. `See the guide at [URL]` is enough; `for more information` adds filler and an unverified promise about the guide.
- Keep negative and mixed findings, authorial and regional language, and genuine uncertainty. A tentative improvement remains an observation, not a "promising" outcome or a reason for reassurance. Drop an unsupported upbeat ending rather than replacing it with a softer endorsement or a denial of the same claim. First person belongs where the source or genre supports experience or judgment.
- Apply Unslop's pattern rules as an editing pass, not permission to replace meaningful voice or required formatting. When its style suggestions conflict with protected detail, evidence, or an explicit style requirement, keep the higher-fidelity version; do not replace one visible tell with another.
- Preserve meaningful Markdown structure, frontmatter, and link targets unless restructuring is requested or the structure obstructs comprehension. Use headings and bullets only when they help the reader navigate; let the material determine their shape.

## Return and check

- For copyediting, return the revised text first. Add notes only when a choice materially changes meaning, risk, or audience fit. For new prose, ask one clarifying question if missing audience, destination, or a hard constraint would materially change the result. If a conflict remains unresolved, do not invent a resolution; report the constraint instead of making a misleading edit.
- Check that the opening makes the point, every paragraph advances the reader's task, citations support their attached claims, and no retained detail, supported voice, or important qualification was lost. Compare each retained quotation, command, URL, name, and number against the source verbatim, including punctuation and quote marks; fix the draft if any differ. Trace each sentence back to retained facts or a reader action. If a sentence exists only to soften or deny a discarded claim (such as "I wouldn't call it a breakthrough"), delete that sentence rather than treating its negation as a useful conclusion.
- For edited Markdown or plain-text files, run `check-prose.py` from this skill directory with explicit target paths. Treat stock-phrase and jargon hits as contextual warnings. It ignores bounded fenced code and same-line inline code; it is not a full Markdown parser or a substitute for the Unslop review. If the checker cannot run, complete the manual review and report that mechanical check as unverified.
