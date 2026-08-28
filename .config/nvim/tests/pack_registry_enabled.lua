local repo_root = assert(vim.env.REPO_ROOT)
local registry_path = repo_root .. "/.config/nvim/lua/config/pack/registry.lua"

local function plugin(overrides)
	return vim.tbl_extend("force", {
		name = "example.nvim",
		src = "https://example.com/example.nvim.git",
	}, overrides or {})
end

do
	local registry = dofile(registry_path)
	local calls = 0
	local deleted
	local pack_del = vim.pack.del
	vim.pack.del = function(names)
		deleted = names
	end
	registry.register(plugin({
		enabled = function()
			calls = calls + 1
			return false
		end,
	}))
	vim.pack.del = pack_del

	assert(calls == 1, "disabled predicate was not evaluated exactly once")
	assert(vim.deep_equal(deleted, { "example.nvim" }), "disabled plugin was not uninstalled")
	assert(registry.get("example.nvim") == nil, "disabled plugin was registered")
	assert(next(registry.all()) == nil, "disabled plugin was exposed by the registry")
	assert(#registry.pack_specs() == 0, "disabled plugin was included in package specs")
end

do
	local registry = dofile(registry_path)
	local calls = 0
	local pack_del = vim.pack.del
	vim.pack.del = function()
		error("enabled plugin must not be uninstalled")
	end
	registry.register(plugin({
		enabled = function()
			calls = calls + 1
			return true
		end,
	}))
	vim.pack.del = pack_del

	assert(calls == 1, "enabled predicate was not evaluated exactly once")
	assert(registry.get("example.nvim") ~= nil, "enabled plugin was not registered")
	assert(#registry.pack_specs() == 1, "enabled plugin was omitted from package specs")
end

do
	local registry = dofile(registry_path)
	local pack_del = vim.pack.del
	vim.pack.del = function()
		error("delete exploded")
	end
	local ok, err = pcall(
		registry.register,
		plugin({
			enabled = function()
				return false
			end,
		})
	)
	vim.pack.del = pack_del

	assert(ok == false, "disabled plugin uninstall failure was ignored")
	assert(
		tostring(err):find("native disabled plugin uninstall failed: example.nvim", 1, true) ~= nil,
		"unexpected disabled plugin uninstall error: " .. tostring(err)
	)
	assert(registry.get("example.nvim") == nil, "plugin with failed uninstall was registered")
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
