local repo_root = assert(vim.env.REPO_ROOT)
local inventory_path = repo_root .. "/.config/nvim/lua/config/pack/inventory.lua"
local discovery_path = repo_root .. "/.config/nvim/lua/config/pack/discovery.lua"

local function plugin(overrides)
	return vim.tbl_extend("force", {
		name = "example.nvim",
		src = "https://example.com/example.nvim.git",
	}, overrides or {})
end

do
	local previous_utils = package.loaded["utils.fn"]
	local categories = {}
	package.loaded["utils.fn"] = {
		require_dir_modules = function(dir)
			table.insert(categories, vim.fs.basename(dir))
			if #categories == 1 then
				return {
					plugin({ name = "single.nvim" }),
					{
						plugin({ name = "list-a.nvim" }),
						plugin({ name = "list-b.nvim" }),
					},
				}, { "plugins.core.single", "plugins.core.list" }
			end
			return {}, {}
		end,
	}
	local declarations = dofile(discovery_path).load()
	package.loaded["utils.fn"] = previous_utils

	assert(
		vim.deep_equal(categories, { "core", "ui", "lang", "workflow", "ai", "misc" }),
		"plugin categories were not discovered in lifecycle order"
	)
	assert(#declarations == 3, "plugin discovery did not flatten returned declarations")
	assert(declarations[1].name == "single.nvim", "single declaration order changed")
	assert(declarations[2].name == "list-a.nvim", "declaration-list order changed")
	assert(declarations[3].name == "list-b.nvim", "declaration-list order changed")
end

do
	local previous_utils = package.loaded["utils.fn"]
	package.loaded["utils.fn"] = {
		require_dir_modules = function()
			return { {} }, { "plugins.core.invalid" }
		end,
	}
	local ok, err = pcall(function()
		dofile(discovery_path).load()
	end)
	package.loaded["utils.fn"] = previous_utils

	assert(not ok, "discovery accepted an invalid module return")
	assert(tostring(err):find("plugins.core.invalid", 1, true), "discovery error omitted the module name")
end

do
	local inventory = dofile(inventory_path)
	local declaration = plugin()
	inventory.register(declaration)

	local first = inventory.current()
	local second = inventory.current()
	assert(first.by_name["example.nvim"] ~= nil, "registered plugin was omitted")
	assert(vim.deep_equal(first.names, { "example.nvim" }), "registered plugin name was omitted")
	assert(#first.pack_specs == 1 and first.pack_specs[1].name == "example.nvim", "package spec was omitted")
	assert(declaration.events == nil, "registration mutated the source declaration")
	assert(
		vim.deep_equal(first.by_name["example.nvim"].events, { { "User", pattern = "PackReady" } }),
		"declaration was not normalized"
	)
	assert(vim.deep_equal(second, first), "equivalent snapshots changed state")

	first.names[1] = "changed.nvim"
	first.pack_specs[1].src = "https://changed.example/plugin.git"
	first.by_name["example.nvim"].events[1].pattern = "Changed"
	local detached = inventory.current()
	assert(detached.names[1] == "example.nvim", "names exposed inventory state")
	assert(
		detached.pack_specs[1].src == "https://example.com/example.nvim.git",
		"package specs exposed inventory state"
	)
	assert(detached.by_name["example.nvim"].events[1].pattern == "PackReady", "declarations exposed inventory state")
end

do
	local inventory = dofile(inventory_path)
	inventory.register({
		plugin({ name = "z.nvim" }),
		plugin({ name = "b.nvim" }),
		plugin({ name = "a.nvim" }),
	})
	local current = inventory.current()
	assert(vim.deep_equal(current.names, { "a.nvim", "b.nvim", "z.nvim" }), "plugin names were not sorted")
	assert(current.pack_specs[1].name == "a.nvim", "package specs were not sorted")
	assert(current.pack_specs[2].name == "b.nvim", "package specs were not sorted")
	assert(current.pack_specs[3].name == "z.nvim", "package specs were not sorted")
end

do
	local inventory = dofile(inventory_path)
	inventory.register(plugin())
	local ok, err = pcall(inventory.register, plugin())
	assert(ok == false, "duplicate plugin registration was accepted")
	assert(
		tostring(err):find("duplicate native plugin registration: example.nvim", 1, true) ~= nil,
		"unexpected duplicate plugin error: " .. tostring(err)
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
	local inventory = dofile(inventory_path)
	local ok, err = pcall(inventory.register, plugin({ name = name }))
	assert(ok == false, "unsafe native plugin name was accepted: " .. name)
	assert(
		tostring(err):find("native plugin name must be one path segment", 1, true) ~= nil,
		"unexpected unsafe native plugin name error: " .. tostring(err)
	)
end

do
	local inventory = dofile(inventory_path)
	local ok, err = pcall(
		inventory.register,
		plugin({
			enabled = function()
				return false
			end,
		})
	)
	assert(ok == false, "enabled predicate was accepted")
	assert(
		tostring(err):find("native enabled predicates are unsupported: example.nvim", 1, true) ~= nil,
		"unexpected enabled predicate error: " .. tostring(err)
	)
end

do
	local modes = { "n", "x", "o", "i", "c", "t", "s" }
	local function keymaps()
		local mappings = {}
		for _, mode in ipairs(modes) do
			mappings[mode] = vim.api.nvim_get_keymap(mode)
		end
		return mappings
	end

	local commands_before = vim.api.nvim_get_commands({ builtin = false })
	local autocmds_before = vim.api.nvim_get_autocmds({})
	local keymaps_before = keymaps()
	local barbar_auto_setup = vim.g.barbar_auto_setup
	local declarations = dofile(discovery_path).load()

	assert(#declarations > 0, "real plugin discovery returned no declarations")
	assert(
		vim.deep_equal(vim.api.nvim_get_commands({ builtin = false }), commands_before),
		"discovery created commands"
	)
	assert(vim.deep_equal(vim.api.nvim_get_autocmds({}), autocmds_before), "discovery created autocmds")
	assert(vim.deep_equal(keymaps(), keymaps_before), "discovery created keymaps")
	assert(vim.g.barbar_auto_setup == barbar_auto_setup, "discovery mutated plugin globals")
	for _, declaration in ipairs(declarations) do
		assert(declaration.enabled == nil, "plugin declaration retained an enabled predicate: " .. declaration.name)
	end

	local inventory = dofile(inventory_path)
	inventory.register(declarations)
	local current = inventory.current()
	assert(#current.names == #declarations, "collective registration lost a real declaration")

	local treesitter = assert(current.by_name["nvim-treesitter"])
	assert(treesitter.startup == true, "Tree-sitter is not startup-loaded")
	assert(treesitter.events == nil, "Tree-sitter still has lazy-load events")
	local leap = assert(current.by_name["leap.nvim"])
	assert(leap.startup ~= true and #leap.keys == 3, "Leap is not key triggered")
	for _, key in ipairs(leap.keys) do
		assert(key.expr == true, "Leap key trigger does not preserve input state: " .. key[1])
	end
	local unimpaired = assert(current.by_name["vim-unimpaired"])
	assert(
		vim.deep_equal(unimpaired.events, { { "User", pattern = "PackReady" } }),
		"vim-unimpaired is not post-start triggered"
	)

	local startup_names = {}
	for name, declaration in pairs(current.by_name) do
		if declaration.startup == true then
			table.insert(startup_names, name)
		end
	end
	table.sort(startup_names)
	assert(
		vim.deep_equal(startup_names, { "mini.sessions", "nvim-treesitter", "transparent.nvim" }),
		"synchronous startup roots changed"
	)
end

do
	local inventory = dofile(inventory_path)
	for _, obsolete in ipairs({
		"get",
		"all",
		"pack_specs",
		"disabled_package_names",
	}) do
		assert(inventory[obsolete] == nil, "obsolete inventory projection remains: " .. obsolete)
	end
	assert(type(inventory.register) == "function", "inventory registration interface is missing")
	assert(type(inventory.current) == "function", "inventory snapshot interface is missing")
end
