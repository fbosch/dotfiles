---
type: regex
target: { source: file, path: created.eval.yaml }
pattern: '(?m)^\s*(judge|backend|model):'
match: not_contains
weight: 2
---
