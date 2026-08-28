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
	registry.register(plugin({
		enabled = function()
			calls = calls + 1
			return false
		end,
	}))

	assert(calls == 1, "disabled predicate was not evaluated exactly once")
	assert(registry.get("example.nvim") == nil, "disabled plugin was registered")
	assert(next(registry.all()) == nil, "disabled plugin was exposed by the registry")
	assert(#registry.pack_specs() == 0, "disabled plugin was included in package specs")
	assert(vim.deep_equal(registry.disabled_package_names(), { "example.nvim" }), "disabled plugin name was omitted")
end

do
	local registry = dofile(registry_path)
	local calls = 0
	registry.register(plugin({
		enabled = function()
			calls = calls + 1
			return true
		end,
	}))

	assert(calls == 1, "enabled predicate was not evaluated exactly once")
	assert(registry.get("example.nvim") ~= nil, "enabled plugin was not registered")
	assert(#registry.pack_specs() == 1, "enabled plugin was omitted from package specs")
	assert(#registry.disabled_package_names() == 0, "enabled plugin was classified as disabled")
end

do
	local registry = dofile(registry_path)
	registry.register({
		plugin({
			name = "z.nvim",
			enabled = function()
				return false
			end,
		}),
		plugin({
			name = "a.nvim",
			enabled = function()
				return false
			end,
		}),
	})

	local names = registry.disabled_package_names()
	assert(vim.deep_equal(names, { "a.nvim", "z.nvim" }), "disabled plugin names were not sorted")
	names[1] = "changed.nvim"
	assert(
		vim.deep_equal(registry.disabled_package_names(), { "a.nvim", "z.nvim" }),
		"disabled plugin names exposed registry state"
	)

	local ok, err = pcall(
		registry.register,
		plugin({
			name = "a.nvim",
			enabled = function()
				return false
			end,
		})
	)
	assert(ok == false, "duplicate disabled plugin registration was accepted")
	assert(
		tostring(err):find("duplicate native plugin registration: a.nvim", 1, true) ~= nil,
		"unexpected duplicate disabled plugin error: " .. tostring(err)
	)
end

for _, name in ipairs({
	".",
	"..",
	"../example.nvim",
	"nested/example.nvim",
	"nested\\example.nvim",
	"\0suffix",
	".\0suffix",
	"..\0suffix",
}) do
	local registry = dofile(registry_path)
	local ok, err = pcall(registry.register, plugin({ name = name }))
	assert(ok == false, "unsafe native plugin name was accepted: " .. name)
	assert(
		tostring(err):find("native plugin name must be one path segment", 1, true) ~= nil,
		"unexpected unsafe native plugin name error: " .. tostring(err)
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
