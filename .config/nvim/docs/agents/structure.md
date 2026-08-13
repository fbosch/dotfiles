# Local Structure and Entrypoints

Entrypoint flow:

- `.config/nvim/init.lua` sets leaders and loads `config`
- `lua/config/init.lua` loads core modules in order

Core modules:

- `config.opts`: options and defaults
- `config.usercmd`: user commands via `utils.set_usrcmd`
- `config.keymaps`: base keymaps + deferred plugin keymaps
- `config.autocmd`: filetype rules, spell, UI behaviors
- `config.abbr`: filetype abbreviations and typo fixes
- `config.builtins`: disabled built-in runtime plugins
- `config.pack`: native package discovery, installation, and activation

Plugin loading:

- `config.pack.discovery` loads declarations from each `lua/plugins/` category
