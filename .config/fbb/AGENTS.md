# FBB Shared Config

Shared personal config consumed by multiple app configs.

## Essentials

- Prefer neutral data files, but shared executable helpers are allowed when they have concrete consumers across configs.
- Do not depend on app-specific APIs here.
- Keep app-specific adapters in their app config directories.
- Add shared files only when at least two consumers need them or one near-term second consumer is planned.
- Do not promote helpers that are only duplicated within one app config; consolidate those inside that app first.
- Keep generated state and caches out of this directory. `bun.lock` is the tracked dependency lock for FBB executables.
- Prefer fail-loud parsing at app boundaries instead of silent fallback defaults.

## Validation

- `bun run test`
- `bun run typecheck`
- `bun run fallow`
