local repo_root = assert(vim.env.REPO_ROOT)
local registry_path = repo_root .. "/.config/nvim/lua/config/pack/registry.lua"
local package_path = vim.fs.joinpath(vim.fn.stdpath("data"), "site", "pack", "core", "opt", "example.nvim")
local marker_path = vim.fs.joinpath(package_path, ".nvim-pack-disabled")
local lock_path = vim.fs.joinpath(vim.fn.stdpath("config"), "nvim-pack-lock.json")

local function plugin(overrides)
	return vim.tbl_extend("force", {
		name = "example.nvim",
		src = "https://example.com/example.nvim.git",
	}, overrides or {})
end

do
	local registry = dofile(registry_path)
	local calls = 0
	local removed = {}
	local created_dir
	local created_marker
	local fs_rm = vim.fs.rm
	local filereadable = vim.fn.filereadable
	local readfile = vim.fn.readfile
	local mkdir = vim.fn.mkdir
	local writefile = vim.fn.writefile
	vim.fs.rm = function(path, opts)
		table.insert(removed, { path = path, opts = opts })
	end
	vim.fn.filereadable = function(path)
		return path == lock_path and 1 or 0
	end
	vim.fn.readfile = function(path)
		assert(path == lock_path, "unexpected lock path: " .. path)
		return { '{"plugins":{"example.nvim":{"rev":"abc","src":"https://example.com/example.nvim.git"}}}' }
	end
	vim.fn.mkdir = function(path, flags)
		created_dir = { path = path, flags = flags }
	end
	vim.fn.writefile = function(lines, path)
		created_marker = { lines = lines, path = path }
	end
	registry.register(plugin({
		enabled = function()
			calls = calls + 1
			return false
		end,
	}))
	registry.cleanup_disabled_packages()
	vim.fs.rm = fs_rm
	vim.fn.filereadable = filereadable
	vim.fn.readfile = readfile
	vim.fn.mkdir = mkdir
	vim.fn.writefile = writefile

	assert(calls == 1, "disabled predicate was not evaluated exactly once")
	assert(#removed == 2, "disabled package and sentinel were not both removed")
	assert(removed[1].path == package_path and removed[2].path == package_path, "unexpected cleanup path")
	assert(vim.deep_equal(removed[1].opts, { recursive = true, force = true }), "package removal was not recursive")
	assert(created_dir.path == package_path and created_dir.flags == "p", "disabled sentinel directory was not created")
	assert(
		created_marker.path == marker_path and #created_marker.lines == 0,
		"disabled sentinel marker was not created"
	)
	assert(registry.get("example.nvim") == nil, "disabled plugin was registered")
	assert(next(registry.all()) == nil, "disabled plugin was exposed by the registry")
	assert(#registry.pack_specs() == 0, "disabled plugin was included in package specs")
end

do
	local registry = dofile(registry_path)
	local calls = 0
	local fs_lstat = vim.uv.fs_lstat
	vim.uv.fs_lstat = function(path)
		assert(path == marker_path, "unexpected enabled plugin marker path")
		return nil
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
	local removed
	local fs_lstat = vim.uv.fs_lstat
	local fs_rm = vim.fs.rm
	vim.uv.fs_lstat = function(path)
		return path == marker_path and { type = "file" } or nil
	end
	vim.fs.rm = function(path)
		removed = path
	end
	registry.register(plugin({
		enabled = function()
			return true
		end,
	}))
	vim.uv.fs_lstat = fs_lstat
	vim.fs.rm = fs_rm

	assert(removed == package_path, "stale disabled sentinel was not removed before enabling")
end

do
	local registry = dofile(registry_path)
	local runtimepath = vim.opt.runtimepath:get()
	vim.opt.runtimepath:append(package_path)
	local ok, err = pcall(
		registry.register,
		plugin({
			enabled = function()
				return false
			end,
		})
	)
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
	local fs_rm = vim.fs.rm
	local filereadable = vim.fn.filereadable
	vim.pack.get = function()
		error("disabled cleanup must not trigger vim.pack lock synchronization")
	end
	vim.fs.rm = function() end
	vim.fn.filereadable = function()
		return 0
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
	vim.fs.rm = fs_rm
	vim.fn.filereadable = filereadable

	assert(ok, "absent disabled plugin cleanup failed: " .. tostring(err))
	assert(registry.get("example.nvim") == nil, "absent disabled plugin was registered")
end

do
	local registry = dofile(registry_path)
	local fs_rm = vim.fs.rm
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
	vim.fs.rm = fs_rm

	assert(ok == false, "disabled plugin cleanup failure was ignored")
	assert(
		tostring(err):find("native disabled plugin cleanup failed: example.nvim", 1, true) ~= nil,
		"unexpected disabled plugin cleanup error: " .. tostring(err)
	)
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
