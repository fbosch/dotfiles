-- config/lazy.lua

-- Bootstrap lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
	vim.fn.system({
		"git",
		"clone",
		"--filter=blob:none",
		"https://github.com/folke/lazy.nvim.git",
		"--branch=stable",
		lazypath,
	})
end

vim.opt.rtp:prepend(vim.env.LAZY or lazypath)
vim.opt.loadplugins = true

-- Define disabled built-in plugins
local disabled_plugins = {
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
	"tutor_mode_plugin",
}

-- Setup lazy.nvim
require("lazy").setup({
	spec = { import = "plugins" },
	change_detection = { notify = false },
	ui = { border = "rounded" },
	concurrency = 32,
	performance = {
		cache = { enabled = true },
		reset_patckpath = true,
		rtp = {
			reset = true,
			disabled_plugins = disabled_plugins,
		},
	},
})
