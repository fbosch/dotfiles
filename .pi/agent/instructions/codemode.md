---
when:
  tools:
    all:
      - codemode
---

# Codemode

- Before each tool phase, identify every call whose inputs are already known.
  If two or more calls do not depend on each other's results or side effects,
  run them in ONE `codemode` script with `Promise.allSettled()`.
  Do this before issuing the first call, and repeat after each prerequisite.
- Batch routine reference reads too. Three known instruction paths are one
  batch; a known file search and two independent content searches are another.
  Different tool names, short outputs, and required reading do not justify
  separate direct calls. Multiple direct calls in one response are not codemode.
- "Separate calls" means distinct tool invocations, not sequential execution.
  Keep those invocations separate inside the batch. Honor explicit requests
  for sequential execution or direct tools without codemode.
- Use a direct tool when the whole task needs only one trivial operation.
  Otherwise, use codemode for independent batches and dependent chains.
- Keep prerequisites and conflicting mutations ordered, including required
  read-back. Await the prerequisite, then batch newly available independent
  calls. Use actual results from earlier calls, not guessed inputs.
- Inspect every result, including rejected calls, fulfilled tool-level errors,
  and command exit codes. Script completion alone does not prove success.

## Output contract

- Treat nested tool results as working data. Do not print full successful
  results or intermediate data consumed entirely within the script.
- Emit a concise report of outcomes, changed paths, validation results, and
  unresolved issues. Distinguish successful edits from verified correctness.
- Report every failure, non-zero exit code, and relevant warning with its exact
  file or tool name and enough evidence to diagnose it.
- For reads, emit only excerpts needed for reasoning or subsequent edits.
  Preserve `{path, anchor, text}` rows when anchors are needed; never print
  both rendered and structured copies.
- For edits, emit focused diffs or boundary excerpts needed to review correctness,
  not entire files or tool responses.
- Filter before calling `text()`, `console.log()`, or returning a value.
  Keep large supporting output in a retrievable artifact and report its path.
