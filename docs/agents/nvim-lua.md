# Neovim Lua Style

## Module Pattern

```lua
local M = {}

-- Private function (local)
local function helper_function()
  -- implementation
end

-- Public function
function M.public_function()
  -- implementation
end

return M
```

## Conventions

- Imports at top: `local git = require("utils.git")`
- Functions use `snake_case`: `function M.wipe_all_sessions()`, `local function get_terminal_width()`
- Indentation: 2 spaces, `expandtab`, `smartindent`
- Error handling: guard clauses, nil checks like `if handle == nil then return nil end`
- Keymaps: use `require("utils").set_keymap()` (not `vim.keymap.set()`)
  - Signature: `set_keymap(mode, lhs, rhs, opts_or_desc)`
  - Defaults: `noremap = true, silent = true`
- User commands: use `require("utils").set_usrcmd()` (not `vim.api.nvim_create_user_command()`)

## Plugin Structure (`vim.pack`)

- Files in `.config/nvim/lua/plugins/{category}/` are registration-only modules.
- Categories: `ai/`, `core/`, `lang/`, `misc/`, `ui/`, `workflow/`

Example spec:

```lua
local register = require("config.pack.registry").register

register({
  name = "plugin-name",
  src = "https://github.com/author/plugin-name.git",
  events = { "BufEnter" },
  opts = {},
})
```
