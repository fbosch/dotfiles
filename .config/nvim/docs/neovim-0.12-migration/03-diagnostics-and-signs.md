# Diagnostics And Signs Migration Plan

## Scope

- `.config/nvim/lua/plugins/core/lsp.lua`
- `.config/nvim/lua/config/keymaps/navigation.lua`
- `.config/nvim/lua/plugins/ui/buffers.lua`
- `.config/nvim/lua/plugins/ui/visuals.lua`

## Goal

Keep diagnostics rendering, navigation, and sign styling consistent on Neovim 0.12 while removing reliance on deprecated or changed diagnostic behavior.

## Why This Area Matters

Neovim 0.12 changes diagnostic-related behavior, especially around sign handling and deprecated API usage. This config also reuses diagnostic highlights and state in UI components, which raises the chance of downstream regressions.

## Plan

1. Locate all diagnostic configuration and navigation entrypoints.
2. Search explicitly for removed and deprecated diagnostic APIs before changing config behavior.
3. Verify sign configuration is expressed only through supported `vim.diagnostic.config()` paths.
4. Ban diagnostic `sign_define()` usage and any old sign-definition path for diagnostics.
5. Audit all use of `DiagnosticSign*` highlight groups and any assumptions tied to sign rendering.
6. Check diagnostic floats, navigation, severity sorting, and virtual text or line behavior.
7. Validate downstream consumers such as buffer UI, trouble lists, and status components.

## Required Checks To Add

1. No `vim.diagnostic.disable()` or `vim.diagnostic.is_disabled()` remains.
2. No diagnostic sign configuration goes through `sign_define()`.
3. Jump behavior should be reviewed for deprecated `float` options and newer `on_jump` hooks.
4. Statusline or UI layers should not duplicate new 0.12 diagnostic summaries.

## Validation

1. Trigger warnings and errors in a test file.
2. Confirm sign icons, line highlights, and number highlights render as expected.
3. Confirm jump navigation and floating diagnostics still behave correctly.
4. Confirm mixed warning and error buffers still navigate in the expected order.
5. Confirm any diagnostic counts or indicators in UI plugins still match visible state.

## Done When

- Diagnostics still render correctly in buffers and UI components.
- Sign-related styling matches current expectations.
- No deprecated diagnostic API remains in active use.
- Navigation and floating windows still work without regressions.

## Likely Grep Targets

- `vim.diagnostic.config`
- `vim.diagnostic.disable`
- `vim.diagnostic.is_disabled`
- `signs =`
- `DiagnosticSign`
- `sign_define`
- `vim.diagnostic.jump`
- `open_float`
- `severity_sort`

## Risks

- Theme and plugin interactions may make a diagnostic issue look like a highlight issue.
- Buffer UI and statusline integrations may lag behind core diagnostics behavior.
