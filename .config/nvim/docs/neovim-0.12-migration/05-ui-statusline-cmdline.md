# UI, Statusline, And Cmdline Migration Plan

## Scope

- `.config/nvim/lua/config/opts.lua`
- `.config/nvim/lua/plugins/ui/statusline.lua`
- `.config/nvim/lua/plugins/ui/visuals.lua`
- `.config/nvim/lua/plugins/ui/wildmenu.lua`

## Goal

Resolve overlap between your custom UI layer and Neovim 0.12 defaults so the interface stays intentional rather than duplicated or conflicting.

## Why This Area Matters

Neovim 0.12 expands built-in statusline and UI behavior. This config already replaces several UI surfaces, including statusline, cmdline completion, and `vim.ui.input` or `vim.ui.select` behavior.

## Plan

1. Compare current UI overrides against new Neovim 0.12 defaults.
2. Identify duplicate statusline data such as diagnostics, progress, and terminal state.
3. Validate `vim.ui.input` and `vim.ui.select` overrides still behave cleanly.
4. Test cmdline completion and prompt flows with `wilder`.
5. Decide which surfaces should stay custom and which should rely on core 0.12 behavior.

## Validation

1. Launch Neovim and inspect statusline in normal buffers and terminal buffers.
2. Trigger UI prompts that use `vim.ui.input` and `vim.ui.select`.
3. Exercise command-line completion and search flows.
4. Confirm there is no duplicated status, prompt, or progress information.

## Done When

- Statusline only shows the information you want.
- Cmdline and prompt flows remain stable.
- UI overrides still win where intended.
- New 0.12 defaults do not introduce duplicate surfaces.

## Likely Grep Targets

- `laststatus`
- `globalstatus`
- `vim.ui.input`
- `vim.ui.select`
- `wilder`
- `statusline`

## Risks

- Some duplicate behavior may be subtle and only appear during LSP progress, terminal exit, or prompt-heavy workflows.
- UI regressions can look cosmetic but still hurt workflow.
