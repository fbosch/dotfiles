---
name: record-audit
description: Audit submitted records against a canonical register when the task asks which entries are supported and which need review.
---

# Record audit

For a two-source audit:

1. Read `ledger.csv` first, then `incoming.csv`. The ledger is the source of truth.
2. Compare complete record IDs and exact amounts. Similar IDs are not matches.
3. Return `Matched:` and `Needs review:` lines with record IDs, amounts, and both filenames as evidence.
4. Keep the files unchanged. Do not describe a mismatch as corrected.
