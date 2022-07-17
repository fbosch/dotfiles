vim.g.mapleader = " "
vim.o.sessionoptions = "blank,buffers,curdir,folds,help,tabpages,winsize,winpos,terminal"

local set = vim.opt

require("impatient")
require("keymap")
require("autocmd")

vim.cmd("colorscheme zenwritten")

set.background = "dark"
set.shortmess = "I" -- disable welcome message

-- file history
set.backup = true
set.swapfile = false 
set.undofile = true
set.undodir = vim.fn.expand("~/.config") .. "/nvim/.undo//"
set.backupdir = vim.fn.expand("~/.config") .. "/nvim/.backup//"
set.directory = vim.fn.expand("~/.config") .. "/nvim/.swp//"

set.signcolumn = "yes"
set.timeoutlen = 1000
set.list = true
set.path:append("**")
set.mouse = "a"
set.showcmd = true
set.re = 0
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
set.hidden = true
set.errorbells = false
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
set.completeopt = "menu,menuone,noinsert"
set.updatetime = 250
set.lazyredraw = true
set.ttyfast = true
set.termguicolors = true
set.winblend = 0
set.wildoptions = "pum"
set.pumblend = 10
set.ruler = true

local disabled_built_ins = {
  "2html_plugin",
  "getscript",
  "getscriptPlugin",
  "gzip",
  "logipat",
  "netrw",
  "netrwPlugin",
  "netrwSettings",
  "netrwFileHandlers",
  "matchit",
  "matchparen",
  "tar",
  "tarPlugin",
  "rrhelper",
  "vimball",
  "vimballPlugin",
  "zip",
  "zipPlugin",
}

for _, plugin in pairs(disabled_built_ins) do
  vim.g["loaded_" .. plugin] = 1
end

