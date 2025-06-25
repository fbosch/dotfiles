vim.loader.enable()

-- leader key
vim.keymap.set("", "<Space>", "<Nop>")
vim.g.mapleader = " "
vim.g.maplocalleader = " "

vim.g.spellfile_URL = "http://ftp.vim.org/vim/runtime/spell"

require("config")
