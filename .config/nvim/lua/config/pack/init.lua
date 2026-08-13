assert(vim.fn.has("nvim-0.12.4") == 1, "native packages require Neovim 0.12.4 or newer")
assert(type(vim.pack) == "table" and type(vim.pack.add) == "function", "vim.pack is unavailable")

local site = vim.fs.joinpath(vim.fn.stdpath("data"), "site")
if not vim.tbl_contains(vim.opt.packpath:get(), site) then
	vim.opt.packpath:append(site)
end
assert(vim.tbl_contains(vim.opt.packpath:get(), site), "native package site is missing from packpath")

require("config.pack.discovery").load()
require("config.pack.build").register()
vim.pack.add(require("config.pack.specs").get(), {
	confirm = true,
	load = function() end,
})
require("config.pack.loader").setup()
