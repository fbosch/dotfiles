vim.loader.enable()

vim.g.mapleader = " "
vim.g.maplocalleader = " "
vim.g.spellfile_URL = "http://ftp.vim.org/vim/runtime/spell"

-- disable built-in plugins
vim.g.loaded_netrw = 1
vim.g.loaded_netrwFileHandlers = 1
vim.g.loaded_netrwSettings = 1
vim.g.loaded_gitignore = 1
vim.g.loaded_netrwPlugin = 1
vim.g.loaded_shada_plugin = 1
vim.g.loaded_matchparen = 1
vim.g.loaded_zip = 1
vim.g.do_filetype_lua = 1

require("config")
