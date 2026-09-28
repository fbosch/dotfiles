---
when:
  tools:
    all:
      - ast_grep_search
      - typesafe_question
---

# Ast-grep and Jev

- When structural matches need semantic judgment, use `pi-lens-ast-grep` for scoped candidate search; use the `ast-grep` skill to develop or debug complex rules.
- Send `typesafe_question` only bounded, non-sensitive match context and a narrow noul, choice, or score question. Keep file/line references locally; batch independent questions over shared state (up to 16).
- Use probabilities to prioritize review, not as proof or permission to edit. Verify consequential judgments against source; dry-run `ast_grep_replace` before any approved replacement.
