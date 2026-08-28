local repo_root = assert(vim.env.REPO_ROOT)
local registry = dofile(repo_root .. "/.config/nvim/lua/config/pack/registry.lua")
local name = "lock-only-example.nvim"
local package_path = vim.fs.joinpath(vim.fn.stdpath("data"), "site", "pack", "core", "opt", name)
local marker_path = vim.fs.joinpath(package_path, ".nvim-pack-disabled")
local lock_path = vim.fs.joinpath(vim.fn.stdpath("config"), "nvim-pack-lock.json")

vim.fn.mkdir(vim.fn.stdpath("config"), "p")
vim.fn.writefile({
	vim.json.encode({
		plugins = {
			[name] = {
				rev = "0000000000000000000000000000000000000000",
				src = "https://invalid.example/lock-only-example.nvim.git",
			},
		},
	}),
}, lock_path)

registry.register({
	name = name,
	src = "https://invalid.example/lock-only-example.nvim.git",
	enabled = function()
		return false
	end,
})

assert(vim.uv.fs_lstat(marker_path) ~= nil, "disabled lock-only package sentinel was not created")
vim.pack.add(registry.pack_specs(), { confirm = false, load = function() end })
registry.cleanup_disabled_packages()

assert(vim.uv.fs_lstat(package_path) == nil, "disabled package sentinel remained after lock synchronization")
vim.pack.update({}, { force = true, offline = true })
local lock = vim.json.decode(table.concat(vim.fn.readfile(lock_path), "\n"))
assert(type(lock.plugins[name]) == "table", "disabled package lock entry was removed")
