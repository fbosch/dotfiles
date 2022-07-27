require("impatient")
require("autocmd")

vim.g.mapleader = " "
vim.o.sessionoptions = "blank,buffers,help,tabpages,winsize,winpos,terminal"
vim.g.did_load_filetypes = 1

local set = vim.opt

-- misc
set.re = 0
set.ttyfast = true
set.lazyredraw = false
set.compatible = false
set.updatetime = 2000

-- visual
set.termguicolors = true
set.shortmess:append("at")
set.number = true
set.signcolumn = "yes"
set.wrap = false
set.ruler = true
set.relativenumber = true

-- file history
set.backup = true
set.swapfile = false
set.undofile = true
set.undodir = vim.fn.expand("~/.config") .. "/nvim/.undo//"
set.backupdir = vim.fn.expand("~/.config") .. "/nvim/.backup//"
set.directory = vim.fn.expand("~/.config") .. "/nvim/.swp//"
set.fileencoding = "utf-8"

-- fold
set.foldlevelstart = 0
set.foldmethod = "marker"
set.backspace = "indent,eol,start"
set.foldexpr = "nvim_treesitter#foldexpr()"

vim.defer_fn(function()
  require("keymap")

  set.scrolloff = 8
  set.list = true
  set.hidden = true
  set.mouse = "a"
  set.cursorline = true
  set.clipboard:append("unnamedplus")
  set.errorbells = false
  -- visual
  set.pumblend = 10
  set.winblend = 0
  set.lazyredraw = true
  set.background = "dark"
  -- timings
  set.timeoutlen = 1000
  set.updatetime = 750
  -- paths
  set.rtp:append("/opt/homebrew/opt/fzf")
  set.path:append("**")
  set.wildoptions = "pum"
  set.wildignore = "*/node_modules/*,*/.npm/*,*.cache*,*go*,*.swp*,*/tmp/*,*/Caches/*,*log*,*.dat*,*.kbx*,*.zip*"
  -- tab & indentation
  set.tabstop = 2
  set.shiftwidth = 2
  set.autoindent = true
  set.expandtab = true
  set.smartindent = true
  set.softtabstop = 2
  set.expandtab = true
  -- show
  set.showcmd = true
  set.showmode = false
  -- completion
  set.complete = "kspell"
  set.completeopt = "menu,menuone,noinsert"
  -- casing
  set.ignorecase = true
  set.smartcase = true
  -- search
  set.incsearch = true
  set.hlsearch = false
end, 100)

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
  "remote_plugins",
  "filetype"
}

for _, plugin in pairs(disabled_built_ins) do
  vim.g["loaded_" .. plugin] = 1
end

