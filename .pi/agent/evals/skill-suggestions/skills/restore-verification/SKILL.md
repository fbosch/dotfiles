---
name: restore-verification
description: Verify a backup restore when asked whether restored data is ready, using its manifest, checksum evidence, and payload record.
---

# Restore verification

1. Read `manifest.json`, then `checksums.txt`, then `payload.txt`.
2. Match the payload identifier and expected checksum across all three records. A payload being present does not prove that it is valid.
3. Report `Conclusion: VERIFIED` only when the checksum matches and the payload record says the restore completed. Otherwise say `NOT VERIFIED` and name the failing or pending evidence.
4. Do not run, repair, or alter the restore.
