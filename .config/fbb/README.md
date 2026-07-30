# FBB Shared Config

Shared personal configuration used by multiple tools in this dotfiles repo.

App-specific integration stays in each app directory. Files here should be neutral data or shared helpers with concrete consumers across configs.

## OCMA

`ocma` manages OpenCode account metadata. It reads credentials from OpenCode's
existing auth file and keeps non-secret aliases in `data/account-aliases.json`.
The executable launcher is `bin/ocma`; its typed command adapter is
`lib/ocma.ts`, separate from the account-state library in
`lib/opencode-multi-auth.ts`.

Commands default to human-readable text. Use `--format json` for scripts and
other configurations. JSON output always has this envelope:

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

`ocma switch <alias>` atomically promotes an inactive `openai_<n>` profile to
the active `openai` profile. `ocma login [alias]` runs OpenCode's OAuth login,
preserves the prior active profile, and assigns the new login to the alias. A
pending login is reported by `status`; the next mutation restores it before
continuing.
