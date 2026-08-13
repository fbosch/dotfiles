# Buffer Line Configuration

## Current Setup: Barbar

**Status:** Active
Barbar is declared in `lua/plugins/ui/buffers.lua` and activates when a second listed buffer appears or an explicit buffer command/key requires it.

## Keybindings

| Key | Action |
|-----|--------|
| `<C-h>` | Previous buffer |
| `<C-l>` | Next buffer |
| `<leader>bd` | Delete current buffer |
| `<leader>x` | Close all but current buffer (and terminals) |

Barbar provides diagnostics, pinning, reordering, and numbered buffer selection. It auto-hides when only one listed buffer exists.
