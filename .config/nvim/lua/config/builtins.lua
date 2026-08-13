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
	"man",
	"net",
	"tar",
	"tarPlugin",
	"rrhelper",
	"vimball",
	"vimballPlugin",
	"zip",
	"zipPlugin",
	"tutor_mode_plugin",
}

for _, plugin in ipairs(disabled_plugins) do
	vim.g["loaded_" .. plugin] = 1
end
vim.g.loaded_man = true
vim.g.loaded_nvim_net_plugin = true
