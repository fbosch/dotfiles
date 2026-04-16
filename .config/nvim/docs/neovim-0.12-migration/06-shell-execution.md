# Shell Execution Migration Plan

## Scope

- `.config/nvim/lua/config/opts.lua`
- `.config/nvim/lua/config/lazy.lua`
- `.config/nvim/lua/utils/terminal.lua`
- `.config/nvim/lua/utils/platform.lua`

## Goal

Verify that shell-command execution still behaves correctly under Neovim 0.12, especially with `fish` configured as the shell.

## Why This Area Matters

Neovim 0.12 changes shell execution details such as the default `'shelltemp'` behavior. This setup uses several command execution styles, including `vim.fn.system`, `io.popen`, and `jobstart`, which can expose quoting, stdin, redirection, or shell integration edge cases.

## Plan

1. Inventory every shell-facing execution path.
2. Split those paths by API family rather than checking them as one bucket.
3. Flag code that depends on shell redirection, temp-file stdin behavior, `/dev/stdin`, or command-string quoting.
4. Validate those paths against `fish` as the configured shell.
5. Check whether any code depends on `FilterRead` or `FilterWrite` events that change with `'shelltemp'` behavior.
6. Convert only fragile paths that actually break on 0.12.
7. Retest terminal helpers and startup shell calls after any change.

## Required Checks To Add

1. Distinguish `vim.fn.system()` from APIs affected by `'shelltemp'` semantics.
2. Test stdin and redirection assumptions explicitly.
3. Add one cross-host sanity check because this repo is used on multiple machines.
4. Prefer targeted modernization to `vim.system({ ... })` only where fragility is proven.

## Validation

1. Test utility functions that invoke shell commands.
2. Validate `vim.fn.system`, `vim.system`, `io.popen`, and `jobstart` paths separately.
3. Confirm output capture still works.
4. Confirm asynchronous jobs still start and return correctly.
5. Check for regressions in terminal-related helpers or startup tasks.

## Done When

- Shell-driven helpers work under 0.12.
- No path relies on behavior changed by `'shelltemp'` unless explicitly intended.
- Command execution remains stable with `fish`.

## Likely Grep Targets

- `vim.opt.shell`
- `vim.fn.system`
- `vim.system`
- `io.popen`
- `jobstart`
- `shelltemp`

## Risks

- Shell issues may appear only on specific commands, not at startup.
- A path that works on one machine shell setup may still fail on another.
- Behavior can differ by execution API even when commands look identical.
