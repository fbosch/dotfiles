require("impatient")

vim.g.mapleader = " "
vim.o.sessionoptions = "blank,buffers,help,tabpages,winsize,winpos,terminal"
vim.g.did_load_filetypes = 1

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
set.shortmess:append("at")
set.compatible = false

-- timings
set.timeoutlen = 1000
set.updatetime = 300

-- visual
set.lazyredraw = true
set.ttyfast = true
set.termguicolors = true
set.number = true
set.signcolumn = "yes"
set.wrap = false
set.ruler = true
set.relativenumber = true
set.cursorline = true

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

-- tab & indentation
set.tabstop = 2
set.shiftwidth = 2
set.autoindent = true
set.expandtab = true
set.smartindent = true
set.softtabstop = 2
set.expandtab = true

require("autocmd")
vim.schedule(function()
  require("plugins")
  vim.schedule(function()
    require("keymap")
    set.scrolloff = 8
    set.list = true
    set.hidden = true
    set.mouse = "a"
    set.clipboard:append("unnamedplus")
    set.errorbells = false
    set.lazyredraw = false
    -- visual
    set.pumblend = 10
    set.winblend = 0
    set.lazyredraw = true
    set.background = "dark"
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
  end)
end)

