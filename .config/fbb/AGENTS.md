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

## TanStack Query

- Type query and mutation option factories against `@tanstack/query-core`; do not add the React adapter solely for option helpers.
- Keep query factories under `lib/*/queryclient/queries/` and let each factory own its query key, request, response validation, and stale policy.
- Execute remote mutations through the shared `QueryClient` and invalidate their associated query-key subtree after success.

## Validation

- `bun run test`
- `bun run typecheck`
- `bun run fallow`
