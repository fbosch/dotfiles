<!-- rtk-instructions v3 (compact) -->

# RTK Rules (Compact)

RTK plugin auto-rewrites `bash`/`shell` commands.

- Write normal commands. Do not add `rtk` manually unless using explicit RTK subcommands.
- Rewritten command display is expected (`pnpm lint` may display as `rtk lint`).
- Treat RTK summaries as authoritative results.

## Result Semantics

- `ok` = command succeeded.
- For `git status --short`: `ok` = clean tree; non-`ok` lines = file changes.
- Do not re-run same status command only to verify `ok`.

## Loop Guard

If summarized command shows parser/adapter warning:

1. Run summarized command once.
2. Run one fallback: `rtk proxy <original-command>`.
3. Treat proxy output as source of truth.
4. Do not retry summarized form unless inputs changed (files/flags/env/cwd).
5. If proxy fails, stop retries and report failure.

Use `rtk proxy ...` when exact raw/machine-readable output required.

Example:

```bash
rtk lint
rtk proxy pnpm lint
```

<!-- /rtk-instructions -->
