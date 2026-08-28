assert(vim.fn.has("nvim-0.12.4") == 1, "native packages require Neovim 0.12.4 or newer")
assert(type(vim.pack) == "table" and type(vim.pack.add) == "function", "vim.pack is unavailable")

local site = vim.fs.joinpath(vim.fn.stdpath("data"), "site")
if not vim.tbl_contains(vim.opt.packpath:get(), site) then
	vim.opt.packpath:append(site)
end
assert(vim.tbl_contains(vim.opt.packpath:get(), site), "native package site is missing from packpath")

require("config.pack.discovery").load()
require("config.pack.build").register()
local registry = require("config.pack.registry")
local added, add_cause = xpcall(function()
	vim.pack.add(registry.pack_specs(), {
		confirm = true,
		load = function() end,
	})
end, debug.traceback)
local cleaned, cleanup_cause = xpcall(registry.cleanup_disabled_packages, debug.traceback)
assert(added, add_cause)
assert(cleaned, cleanup_cause)
require("config.pack.loader").setup()
