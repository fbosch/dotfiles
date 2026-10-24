# Scope and budgets

## Assignment contract

- Make each `prompt` self-contained: one verifiable deliverable, named targets and paths, supplied evidence, owned files, exclusions, one targeted validation command, and a stopping point. Inherited context does not replace these details. Pass known findings rather than asking workers to rediscover them.
- Copy the user's acceptance criteria and output requirements verbatim, then add scope and budget without weakening that contract. Distinguish completed prerequisites from work still required. Keep the parent orchestration workflow out of worker prompts.
- Preserve required values and existing source identifiers verbatim through handoffs and the final answer. If the task requests an evidence identifier, require the one already in the source, not invented labels such as E1. Report its absence if none exists.
- In a shared working directory, pass the user's relative paths unchanged. If a different working directory requires an absolute path, copy a verified path rather than reconstructing one.
- Keep implementation and its focused regression tests together. Split broad discovery, cross-feature implementation, full-suite validation, and hosted benchmarking into separately reviewed assignments.

## Procedure boundaries

- If an assigned artifact defines the procedure, require the worker to read it first, extract its actual rule, then act and report. For artifact-directed synchronization, the first tool call must read the owned artifact; only then may the worker invoke its exact specified action and arguments. Prohibit pre-read waits and substitute coordination actions. Do not infer a protocol from a task label.
- For bounded reads or verification without synchronization, require the worker to read the named artifact immediately, use the supplied evidence, and report. Prohibit gates, barriers, waits, and parent-observation protocols.
- Explicitly prohibit blocking or coordination tools unless the task requires them. Available tools do not grant authorization.

## Budget meaning

The entrypoint sets launch limits. `maxTurns` is an initial allowance, not a guarantee of elapsed time or tool-call count. A specialist's optional `hard_max_turns` supplies the ceiling; assignment `hardMaxTurns` may only lower it. Missing ceilings imply no automatic reserve turns. Classifier advice grants neither additional turns nor permissions and cannot guarantee a final handoff.
