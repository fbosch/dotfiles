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
2. Inventory every default surface 0.12 now provides that overlaps with current custom UI.
3. Identify duplicate statusline data such as diagnostics, progress, and terminal state.
4. Validate `vim.ui.input` and `vim.ui.select` overrides still behave cleanly.
5. Test cmdline completion and prompt flows with `wilder`.
6. Test search completion paths because 0.12 changes `wildchar` behavior in search contexts.
7. Check whether any custom UI path depends on changed message or UI events.
8. Decide which surfaces should stay custom and which should rely on core 0.12 behavior.

## Required Checks To Add

1. Compare normal buffers and terminal buffers with LSP progress active.
2. Test `:`, `/`, `?`, `:g`, and `:vimgrep` completion paths.
3. Validate fallback behavior if `vim.ui.input` or `vim.ui.select` wrappers load late.
4. Ensure diagnostics or progress do not render twice across statusline and notifications.

## Validation

1. Launch Neovim and inspect statusline in normal buffers and terminal buffers.
2. Trigger UI prompts that use `vim.ui.input` and `vim.ui.select`.
3. Exercise command-line completion and search flows.
4. Confirm there is no duplicated status, prompt, or progress information.
5. Confirm message-heavy flows still behave cleanly with custom UI enabled.

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
- Older cmdline plugins may depend on message or completion internals that changed in 0.12.
