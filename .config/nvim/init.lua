
require("plugins")
require("keymap")
require("autocmd")


local set = vim.opt
local cmd = vim.cmd

vim.g.mapleader = ","

cmd("colorscheme zenwritten")

set.mouse = "a"
set.gdefault = true
set.expandtab = true
set.compatible = false
set.showmode = false
set.wildignore = "*/node_modules/*,*/.npm/*,*.cache*,*go*,*.swp*,*/tmp/*,*/Caches/*,*log*,*.dat*,*.kbx*,*.zip*"
set.fileencoding = "utf-8"
set.foldmethod = "marker"
set.foldexpr = "nvim_treesitter#foldexpr()"
set.wrap = false
set.backspace = "indent,eol,start"
set.number = true
set.relativenumber = true
set.ignorecase = true
set.cursorline = true
set.smartcase = true
set.incsearch = true
set.hlsearch = false
set.clipboard:append("unnamedplus")
set.complete = "kspell"
set.completeopt = "menuone,longest"
set.updatetime = 100
set.lazyredraw = true
set.ttyfast = true
set.termguicolors = true
set.winblend = 0
set.wildoptions = "pum"
set.pumblend = 5
set.background = "dark"
