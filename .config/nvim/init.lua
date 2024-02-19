vim.opt.shortmess:append("I")
vim.loader.enable()

vim.g.mapleader = " "
vim.g.spellfile_URL = "http://ftp.vim.org/vim/runtime/spell"

-- disable built-in plugins
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1
vim.g.loaded_shada_plugin = 1
vim.g.loaded_matchparen = 1
vim.g.loaded_zip = 1

vim.api.nvim_create_user_command("Z", "wa | qa", {})

require("plugin")
require("options")
require("autocmd")
require("keymap")
