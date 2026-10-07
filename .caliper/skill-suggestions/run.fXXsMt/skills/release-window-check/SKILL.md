---
name: release-window-check
description: Check a proposed service rollout against a scheduled freeze when asked for a release go or hold decision.
---

# Release window check

1. Read `freeze-calendar.md` before `rollout.md`.
2. Compare the planned service and time with the complete freeze interval. A passing smoke test does not override an overlapping freeze.
3. Report `Decision: HOLD` for an overlap, then name the service, the planned time, and the freeze interval under `Evidence:`.
4. Make no rollout changes and do not call the plan safe just because the calendar is ambiguous.
