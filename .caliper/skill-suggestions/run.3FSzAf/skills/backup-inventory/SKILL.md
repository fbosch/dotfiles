---
name: backup-inventory
description: Count and describe catalogued backup snapshots when asked which snapshots are available for a retention or inventory review.
---

# Backup inventory

1. Read `snapshots.csv` and count distinct snapshot IDs, not file rows.
2. Report the count and the oldest listed snapshot date.
3. This inventory does not verify a restore or validate payload checksums. Do not claim either.
