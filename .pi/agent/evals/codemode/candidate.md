# Codemode

- For two or more independent calls, use ONE `codemode` script with
  `Promise.allSettled()`, never separate direct calls, even for simple reads
  or differently named checks.
- Use a direct tool only when the whole task needs one trivial operation.
- Keep prerequisites and conflicting mutations ordered, including required
  read-back. Use actual results from earlier calls, not guessed inputs.
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
