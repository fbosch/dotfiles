# Options, Autocmds, and Keymaps

Options highlights:

- Spellcheck is deferred to text-heavy filetypes (see `config.autocmd`).
- State dirs: `.undo`, `.backup`, `.swp`, `.sessions` under `stdpath("config")`.
- Filetype and syntax are disabled early for startup (re-enabled by plugins).

Autocmds:

- Filetype overrides: JSON5, MDX.
- Spell on for text filetypes (unless VSCode).
- Relative number toggled by insert/normal state.
- `checktime` on focus/enter, notify on external changes.

Keymaps:

- Base maps are loaded from `config.keymaps.*`.
- Plugin maps load on `VeryLazy` to avoid heavy startup.
- Use `utils.set_keymap` for consistency.
