---
name: ledger-reconciliation
description: Reconcile incoming ledger entries against an authoritative ledger when a request asks for exact record matching or discrepancy review.
---

# Ledger reconciliation

For a comparison request:

1. Read `ledger.csv` before `incoming.csv`. Treat the ledger as authoritative.
2. Match by the complete `record_id`; compare the amount exactly. Do not infer a match from a similar identifier.
3. Report separate `Matched:` and `Needs review:` lines. Include the record ID, amount from each source, and both source filenames.
4. Do not edit either file or claim that a discrepancy is resolved.
