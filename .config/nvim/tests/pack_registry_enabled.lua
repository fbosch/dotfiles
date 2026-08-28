local repo_root = assert(vim.env.REPO_ROOT)
local registry_path = repo_root .. "/.config/nvim/lua/config/pack/registry.lua"
local example_path = vim.fs.joinpath(vim.fn.stdpath("data"), "site", "pack", "core", "opt", "example.nvim")

local function plugin(overrides)
	return vim.tbl_extend("force", {
		name = "example.nvim",
		src = "https://example.com/example.nvim.git",
	}, overrides or {})
end

do
	local registry = dofile(registry_path)
	local calls = 0
	local removed
	local fs_lstat = vim.uv.fs_lstat
	local fs_rm = vim.fs.rm
	vim.uv.fs_lstat = function(path)
		assert(path == example_path, "unexpected disabled plugin path: " .. path)
		return { type = "directory" }
	end
	vim.fs.rm = function(path, opts)
		removed = { path = path, opts = opts }
	end
	registry.register(plugin({
		enabled = function()
			calls = calls + 1
			return false
		end,
	}))
	vim.uv.fs_lstat = fs_lstat
	vim.fs.rm = fs_rm

	assert(calls == 1, "disabled predicate was not evaluated exactly once")
	assert(removed.path == example_path, "disabled plugin directory was not removed")
	assert(
		vim.deep_equal(removed.opts, { recursive = true, force = true }),
		"disabled plugin removal was not recursive"
	)
	assert(registry.get("example.nvim") == nil, "disabled plugin was registered")
	assert(next(registry.all()) == nil, "disabled plugin was exposed by the registry")
	assert(#registry.pack_specs() == 0, "disabled plugin was included in package specs")
end

do
	local registry = dofile(registry_path)
	local calls = 0
	local fs_lstat = vim.uv.fs_lstat
	vim.uv.fs_lstat = function()
		error("enabled plugin must not be inspected for cleanup")
	end
	registry.register(plugin({
		enabled = function()
			calls = calls + 1
			return true
		end,
	}))
	vim.uv.fs_lstat = fs_lstat

	assert(calls == 1, "enabled predicate was not evaluated exactly once")
	assert(registry.get("example.nvim") ~= nil, "enabled plugin was not registered")
	assert(#registry.pack_specs() == 1, "enabled plugin was omitted from package specs")
end

do
	local registry = dofile(registry_path)
	local fs_lstat = vim.uv.fs_lstat
	local fs_rm = vim.fs.rm
	vim.uv.fs_lstat = function()
		return { type = "directory" }
	end
	vim.fs.rm = function()
		error("remove exploded")
	end
	local ok, err = pcall(
		registry.register,
		plugin({
			enabled = function()
				return false
			end,
		})
	)
	vim.uv.fs_lstat = fs_lstat
	vim.fs.rm = fs_rm

	assert(ok == false, "disabled plugin cleanup failure was ignored")
	assert(
		tostring(err):find("native disabled plugin cleanup failed: example.nvim", 1, true) ~= nil,
		"unexpected disabled plugin cleanup error: " .. tostring(err)
	)
	assert(registry.get("example.nvim") == nil, "plugin with failed cleanup was registered")
end

do
	local registry = dofile(registry_path)
	local fs_lstat = vim.uv.fs_lstat
	local fs_rm = vim.fs.rm
	local runtimepath = vim.opt.runtimepath:get()
	vim.uv.fs_lstat = function()
		return { type = "directory" }
	end
	vim.opt.runtimepath:append(example_path)
	vim.fs.rm = function()
		error("active plugin directory must not be removed")
	end
	local ok, err = pcall(
		registry.register,
		plugin({
			enabled = function()
				return false
			end,
		})
	)
	vim.uv.fs_lstat = fs_lstat
	vim.fs.rm = fs_rm
	vim.opt.runtimepath = runtimepath

	assert(ok == false, "active disabled plugin was removed")
	assert(
		tostring(err):find("native disabled plugin is active: example.nvim", 1, true) ~= nil,
		"unexpected active disabled plugin error: " .. tostring(err)
	)
end

do
	local registry = dofile(registry_path)
	local pack_get = vim.pack.get
	local fs_lstat = vim.uv.fs_lstat
	vim.pack.get = function()
		error("disabled cleanup must not trigger vim.pack lock synchronization")
	end
	vim.uv.fs_lstat = function()
		return nil
	end
	local ok, err = pcall(
		registry.register,
		plugin({
			enabled = function()
				return false
			end,
		})
	)
	vim.pack.get = pack_get
	vim.uv.fs_lstat = fs_lstat

	assert(ok, "absent disabled plugin cleanup failed: " .. tostring(err))
	assert(registry.get("example.nvim") == nil, "absent disabled plugin was registered")
end

local invalid_cases = {
	{
		enabled = true,
		error = "native enabled must be a function: example.nvim",
	},
	{
		enabled = function()
			error("predicate exploded")
		end,
		error = "native enabled predicate failed: example.nvim",
	},
	{
		enabled = function()
			return "yes"
		end,
		error = "native enabled predicate must return a boolean: example.nvim",
	},
}

for _, case in ipairs(invalid_cases) do
	local registry = dofile(registry_path)
	local ok, err = pcall(registry.register, plugin({ enabled = case.enabled }))
	assert(ok == false, "invalid enabled predicate was accepted")
	assert(tostring(err):find(case.error, 1, true) ~= nil, "unexpected enabled predicate error: " .. tostring(err))
end
