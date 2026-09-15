---
type: regex
target: { source: file, path: mixed-backend.eval.yaml }
pattern: '(?m)^\s*(judge|backend|model):'
match: not_contains
weight: 2
---
