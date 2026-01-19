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
- Functions use `snake_case`: `function M.word_wrap()`, `local function get_terminal_width()`
- Indentation: 2 spaces, `expandtab`, `smartindent`
- Error handling: guard clauses, nil checks like `if handle == nil then return nil end`
- Keymaps: use `require("utils").set_keymap()` (not `vim.keymap.set()`)
  - Signature: `set_keymap(mode, lhs, rhs, opts_or_desc)`
  - Defaults: `noremap = true, silent = true`
- User commands: use `require("utils").set_usrcmd()` (not `vim.api.nvim_create_user_command()`)

## Plugin Structure (Lazy.nvim)

- Files in `.config/nvim/lua/plugins/{category}/` return table(s) with plugin specs
- Categories: `ai/`, `core/`, `lang/`, `misc/`, `ui/`, `workflow/`

Example spec:

```lua
return {
  {
    "author/plugin-name",
    dependencies = { "other/plugin" },
    event = "VeryLazy", -- or cmd, keys, ft, etc.
    config = function()
      require("plugin-name").setup({ ... })
    end,
  },
}
```
