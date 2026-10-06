---
when:
  tools:
    all:
      - codemode
---

# Codemode

- Keep prerequisites and conflicting mutations ordered, including required
  read-back. Do not guess inputs supplied by an earlier call.
- Inspect every result, including fulfilled tool-level errors and command exit
  codes. Report failures by source while retaining successful results.
- Filter output before printing. For reads, return only relevant
  `{path, anchor, text}` rows, never both rendered and structured copies.
- Use a direct tool for one trivial operation.
