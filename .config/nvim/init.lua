vim.g.mapleader = ","
local set = vim.opt

require("impatient")
require("plugins")
require("keymap")
require("autocmd")

vim.cmd("colorscheme zenwritten")

set.timeoutlen = 1500
set.background = "dark"
set.path:append("**")
set.mouse = "a"
set.showcmd = true
set.re = 1
set.scrolloff = 8
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
set.tabstop = 2
set.shiftwidth = 2
set.autoindent = true
set.expandtab = true
set.softtabstop = 2
set.smartindent = true
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
set.pumblend = 10
set.ruler = true
