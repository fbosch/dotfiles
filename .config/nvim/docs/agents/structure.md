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
- `config.lazy`: Lazy.nvim bootstrap

Plugin loading:

- `lua/plugins/init.lua` imports plugin categories
- UI/lang/workflow/ai are disabled in VSCode mode
