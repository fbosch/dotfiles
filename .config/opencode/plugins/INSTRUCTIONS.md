# OpenCode Plugins

Three local plugins are registered directly in `opencode.json`:

- `machine-context` for chat context injection
- `just-bash` for shell tool registration
- `rtk` for pre-execution command rewriting

## `just-bash`

- The `bash` tool is not the stock shell tool. It runs inside an in-memory OverlayFS sandbox provided by `just-bash`.
- Reads come from the real project tree, but writes made through `bash` stay in memory and are discarded. Do not rely on `bash` for persistent file changes.
- Use OpenCode file-editing tools for real file modifications.
- The sandbox is a TypeScript shell simulation, not a full system shell. Prefer simple POSIX-style commands and expect some unsupported behavior for complex shell features or arbitrary binaries.

## `host_exec`

- `just-bash` may also register `host_exec` for commands that must run on the real host.
- `host_exec` is restricted by the merged OpenCode permission config plus `just-bash` plugin config.
- In this repo, the intended allowed host commands are `gh`, `git`, `jq`, `systemctl`, `journalctl`, and `opencode`.
- `host_exec` rejects unsafe shell constructs such as newlines, subshells, backticks, process substitution, and env-var-prefixed commands.
- `host_exec` only allows working directories inside the current worktree or explicitly allowed external directories.
- Use `host_exec` only when sandbox execution is insufficient and the command genuinely needs real host access.

## `rtk`

- `rtk` means Rust Token Killer.
- When the `rtk` binary is available on the host, the plugin rewrites recognized `bash` and `host_exec` commands through `rtk rewrite` before execution.
- Do not manually prefix commands with `rtk`; write the normal command and let the plugin rewrite it.
- Rewritten command output may be compressed or filtered compared with raw CLI output. Treat that as expected unless you specifically need verbatim output.
- If `rtk` is not installed, the plugin becomes a no-op and commands run normally.

## Agent expectations

- Prefer `bash` for read-only shell exploration and lightweight command execution.
- Prefer file tools over shell writes because `bash` writes are ephemeral.
- Prefer `host_exec` only for the small set of host-level commands that need the real system.
- Assume `rtk` may change the presentation of command output while preserving the useful signal.
- Do not modify plugin code or plugin config files unless the task is explicitly about those plugins.
