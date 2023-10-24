vim.g.mapleader = " "
vim.g.spellfile_URL = "http://ftp.vim.org/vim/runtime/spell"

-- disable netrw
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1

-- misc
vim.opt.re = 0 -- regex engine auto
vim.opt.shortmess:append("I")
vim.opt.compatible = false
vim.opt.shell = "fish"
vim.opt.title = false
vim.opt.filetype = "on"

-- timings
vim.opt.timeoutlen = 1000
vim.opt.updatetime = 100

-- visual
vim.opt.lazyredraw = true
vim.opt.ttyfast = true
vim.opt.termguicolors = true
vim.opt.background = "dark"
vim.opt.number = true
vim.opt.signcolumn = "yes"
vim.opt.wrap = false -- disable line wrap
vim.opt.relativenumber = true
vim.opt.cursorline = true
vim.opt.fillchars:append("eob:·")
vim.opt.laststatus = 3

-- file history
vim.opt.backup = true
vim.opt.swapfile = false
vim.opt.undofile = true
vim.opt.undodir = vim.fn.stdpath("config") .. "/nvim/.undo//"
vim.opt.backupdir = vim.fn.stdpath("config") .. "/nvim/.backup//"
vim.opt.directory = vim.fn.stdpath("config") .. "/nvim/.swp//"
vim.opt.sessionoptions = "buffers,help,tabpages,winsize,winpos,terminal,options"
vim.opt.fileencoding = "utf-8"
vim.opt.autoread = true

-- fold
vim.opt.foldcolumn = "1"
vim.o.foldlevel = "99"
vim.o.foldlevelstart = "99"
vim.o.foldenable = true
vim.opt.foldlevelstart = 0
vim.opt.foldmethod = "marker"
vim.opt.backspace = "indent,eol,start"
vim.opt.foldexpr = "nvim_treesitter#foldexpr()"

-- spellchecking
vim.opt.spell = false
vim.opt.spelllang = "en,da"
vim.opt.spelloptions = "camel"

-- tab & indentation
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2
vim.opt.autoindent = true
vim.opt.smartindent = true
vim.opt.softtabstop = 2
vim.opt.expandtab = true

vim.opt.list = true
vim.opt.hidden = true
vim.opt.mouse:append("a")
vim.opt.clipboard:append("unnamedplus")
vim.opt.errorbells = false

-- paths
vim.opt.rtp:append("/opt/homebrew/opt/fzf")
vim.opt.path:append("**")
vim.opt.wildoptions = "pum"
vim.opt.wildignore:append(
	"*/node_modules/*,*/.npm/*,*.cache*,*go*,*.swp*,*/tmp/*,*/Caches/*,*log*,*.dat*,*.kbx*,*.zip*"
)

-- show
vim.opt.showcmd = true
vim.opt.showmode = true

-- completion
vim.opt.complete = "kspell"
vim.opt.completeopt = "menu,menuone,noinsert"

-- casing
vim.opt.ignorecase = true
vim.opt.smartcase = true

-- search
vim.opt.incsearch = true
vim.opt.hlsearch = false

require("keymap")
require("autocmd")
require("plugin")
