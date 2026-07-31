# FBB Shared Config

Shared personal configuration used by multiple tools in this dotfiles repo.

App-specific integration stays in each app directory. Files here should be neutral data or shared helpers with concrete consumers across configs.

## OCMA

`ocma` manages OpenCode account metadata. It reads credentials from OpenCode's
existing auth file and keeps non-secret aliases in `data/opencode/account-aliases.json`.
The executable launcher is `bin/ocma`; its typed command adapter is
`lib/opencode-multi-auth/index.ts`, separate from the account-state library in
`lib/opencode-multi-auth/opencode-multi-auth.ts`. The FBB Bun package provides Citty command
parsing and Clack interactive prompts; Bun automatically installs its locked
dependencies when `ocma` first runs on a new machine or finds an incomplete
`node_modules` tree. If the registry is unavailable, `ocma` exits non-zero
without changing account state.

Commands default to human-readable text. Use `--format json` for scripts and
other configurations. `ocma login` is interactive and only supports text
output; use JSON with the query and switch commands. `--no-color` disables
ANSI color and `--plain` uses a narrow-safe, decoration-free text layout.
JSON output always has this envelope:

```json
{
  "schema": "fbb.ocma/v1",
  "command": "list",
  "outcome": "success",
  "data": {},
  "diagnostics": []
}
```

`outcome` is `success`, `warning`, or `error`. Warnings and errors exit
non-zero. JSON never includes access tokens, refresh tokens, JWTs, or account
IDs.

`ocma switch [alias]` atomically promotes an inactive `openai_<n>` profile to
the active `openai` profile. Without an alias, it opens an interactive account
picker. `ocma login [alias]` runs OpenCode's OAuth login,
preserves the prior active profile, and assigns the new login to the alias. A
pending login is reported by `status`; the next mutation restores it before
continuing.
