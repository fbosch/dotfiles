---
name: nix-run
description: |
  Run one-off Linux CLI tools from nixpkgs without installing them globally. Use when a task hits command-not-found or missing executable errors, or when an ephemeral tool should be run via `nix run` (or comma) instead of adding system dependencies.
---

# Nix Run Skill

## Workflow

1. Resolve the required executable from the task.
2. Check whether it already exists with `command -v <exe>`.
3. If missing, run it with `nix run nixpkgs#<pkg> -- <args>`.
4. Keep execution non-interactive and task-scoped.

## Strict invocation policy

- Use `nix run` for ephemeral execution only. Do not install packages or edit system/user package config.
- Use one explicit package per command: `nix run nixpkgs#<pkg> -- ...`.
- Always include `--` before tool arguments.
- Prefer direct tool entrypoints over `bash -lc` wrappers. Shell wrapping often mutates quoting/escaping and makes failures harder to trace.
- Do not run background daemons/services through this skill.
- Do not run destructive commands (`rm -rf`, partitioning, firewall rewrites, privilege changes) unless explicitly requested. `nix run` lowers install risk, not runtime command risk.
- If a tool is already present and version constraints are not specified, prefer the installed tool to avoid unnecessary Nix downloads.

## Deterministic execution defaults

- `FIRST_TIMEOUT_MS=120000` (2 minutes)
- `RETRY_TIMEOUT_MS=600000` (10 minutes)
- `MAX_RETRIES=1`
- Stop after one retry and report fallback options; do not loop.

## Command patterns

```bash
# Generic pattern
nix run nixpkgs#<pkg> -- <command-args>

# Example: yt-dlp one-off usage
nix run nixpkgs#yt-dlp -- --version

# Example: ffmpeg one-off usage
nix run nixpkgs#ffmpeg -- -version
```

## Timeout and failure fallback rules

1. First attempt: run with `FIRST_TIMEOUT_MS`.
2. If the run times out during fetch/build, retry once with `RETRY_TIMEOUT_MS`.
3. If retry also times out, report that Nix materialization is too slow for this session and propose alternatives (installed tool, simpler command, or user-provided package choice).
4. If package lookup fails (`attribute ... not found`), try one correction pass:
   - confirm package name with `nix search nixpkgs <term>`
   - retry with the corrected package name
5. If execution fails due to runtime/tool arguments, surface the exact stderr cause and propose the smallest argument fix.

## Failure routing matrix

| Symptom | Likely cause | Next action |
|---|---|---|
| `attribute 'X' not found` | wrong package attribute | run `nix search nixpkgs <term>`, pick closest exact attr, retry once |
| `command not found` after `nix run` | package entrypoint differs from package name | rerun with explicit command if needed: `nix run nixpkgs#<pkg> -- <actual-binary> ...` |
| immediate argument parse failure | wrong argument shape for wrapped tool | keep package, minimally adjust args only, retry once |
| repeated fetch/build timeout | cold cache or poor network | stop after retry, report timeout and suggest installed tool or narrower command |
| interactive prompt blocks execution | command expects TTY/user input | rerun with non-interactive flags or stop and request explicit user input intent |

## Output expectations

- State the exact `nix run` command used.
- Mention whether it succeeded on first run, retry, or failed.
- If fallback happened, explain which fallback rule triggered.
