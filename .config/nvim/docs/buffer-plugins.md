# Buffer Line Configuration - mini.tabline vs barbar

## Current Setup: mini.tabline ✅

**Status:** Active
**Performance:** ~2ms startup (90% faster than barbar)

### Switching Between mini.tabline and barbar

Your config supports easy switching between the two plugins:

**File:** `~/.config/nvim/lua/plugins/ui/buffers.lua`

#### To use mini.tabline (current):
```lua
{
  "echasnovski/mini.tabline",
  enabled = true,  -- ✅ ACTIVE
  ...
},
{
  "romgrk/barbar.nvim",
  enabled = false,  -- ❌ DISABLED
  ...
}
```

#### To switch back to barbar:
1. Edit `/home/fbb/.config/nvim/lua/plugins/ui/buffers.lua`
2. Change mini.tabline `enabled = false`
3. Change barbar.nvim `enabled = true`
4. Restart Neovim or run `:Lazy sync`

## Keybindings (same for both)

| Key | Action |
|-----|--------|
| `<C-h>` | Previous buffer |
| `<C-l>` | Next buffer |
| `<leader>bd` | Delete current buffer |
| `<leader>x` | Close all but current buffer (and terminals) |

## Differences

### mini.tabline
✅ Much faster startup (~2ms)
✅ Clean, minimal design
✅ Shows file icons
✅ Auto-hides when one buffer
❌ No LSP diagnostics in tabline
❌ No buffer pinning
❌ No buffer reordering (Ctrl+Alt+h/l)
❌ No jump-to-buffer by number (Alt+1-9)

### barbar.nvim
✅ Rich features (LSP diagnostics, git status)
✅ Buffer pinning (`<leader>P`)
✅ Buffer reordering (`<C-A-h>`, `<C-A-l>`)
✅ Jump to buffer by number (`<A-1>` through `<A-9>`)
✅ Customizable separators and colors
❌ Slower startup (~20ms)

## Performance Impact

- **With barbar:** 47ms startup
- **With mini.tabline:** ~29ms startup (38% improvement)

## Recommendation

- **Keep mini.tabline** if you value speed and simplicity
- **Switch to barbar** if you need advanced features like:
  - Buffer pinning
  - LSP diagnostics in the tabline
  - Git status indicators
  - Jump-to-buffer shortcuts

Both are excellent plugins - choose based on your workflow!
