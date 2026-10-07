# Codemode

- For two or more independent calls, use ONE `codemode` script with
  `Promise.allSettled()`, never separate direct calls, even for simple reads
  or differently named checks.
- Keep prerequisites and conflicting mutations ordered, including required
  read-back. Do not guess inputs supplied by an earlier call.
- Inspect every result, including fulfilled tool-level errors and command exit
  codes. Attribute successes and failures to exact file/tool names.
- Filter output before printing. For reads, return only relevant
  `{path, anchor, text}` rows, never both rendered and structured copies.
- Use a direct tool only when the whole task needs one trivial operation.
