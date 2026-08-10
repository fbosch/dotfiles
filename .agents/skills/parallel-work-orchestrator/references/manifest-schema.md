# Execution Manifest

Create this manifest before requesting approval for write-capable work. Keep it in the conversation unless a task needs resumable state.

```yaml
objective: <observable outcome>
mode: read-only | write
baseline: <HEAD or other observable baseline>
concurrency: 2-4
acceptance:
  - <final check or invariant>
shared_resources:
  - <coordinator-owned path or resource>
waves:
  - id: 1
    units:
      - id: <stable unit id>
        goal: <one observable outcome>
        route: quick | refactor | <other agent>
        owns:
          - <exact writable path or input>
        reads:
          - <relevant context>
        forbidden:
          - <shared or another unit's path>
        depends_on: []
        acceptance:
          - <unit invariant>
        validation:
          - <exact command or inspection>
```

Rules:

- Assign a writable path to one unit in one active wave only.
- Treat an uncertain, generated, or shared output as coordinator-owned until proven otherwise.
- Put units with dependencies in a later wave.
- Do not use an empty ownership list for write-capable units.
- Use explicit inputs instead of paths for non-file work, such as audit records or issue IDs.
- Reject or serialize units with overlapping ownership.
