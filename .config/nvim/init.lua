require("impatient")

vim.g.mapleader = " "
vim.o.sessionoptions = "buffers,help,tabpages,winsize,winpos,terminal"
vim.o.cmdheight = 0
vim.g.did_load_filetypes = 1
vim.g.spellfile_URL = "http://ftp.vim.org/vim/runtime/spell"

vim.g.vimade = {
  fadelevel = 0.6,
  usecursorhold = true,
  updatetime = 20,
  detecttermcolors = true,
  enablescroll = 1,
  enabletreesitter = 1
}

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
  "filetype",
  "tutor_mode_plugin",
}

for _, plugin in pairs(disabled_built_ins) do
  vim.g["loaded_" .. plugin] = 1
end

local set = vim.opt

-- misc
set.re = 0 -- regex engine auto
set.shortmess:append("I")
set.compatible = false

-- timings
set.timeoutlen = 1000
set.updatetime = 150

-- visual
set.lazyredraw = false
set.ttyfast = true
set.termguicolors = true
set.number = true
set.signcolumn = "yes"
set.wrap = false
set.relativenumber = true
set.cursorline = true
set.fillchars:append("eob:·")


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

-- spellchecking
set.spell = false
set.spelllang = "en,da"
set.spelloptions = "camel"

-- tab & indentation
set.tabstop = 2
set.shiftwidth = 2
set.autoindent = true
set.expandtab = true
set.smartindent = true
set.softtabstop = 2
set.expandtab = true

set.list = true
set.hidden = true
set.mouse = "a"
set.clipboard:append("unnamedplus")
set.errorbells = false

-- paths
set.rtp:append("/opt/homebrew/opt/fzf")
set.path:append("**")
set.wildoptions = "pum"
set.wildignore = "*/node_modules/*,*/.npm/*,*.cache*,*go*,*.swp*,*/tmp/*,*/Caches/*,*log*,*.dat*,*.kbx*,*.zip*"

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

require("keymap")
require("autocmd")
require("plugins")
