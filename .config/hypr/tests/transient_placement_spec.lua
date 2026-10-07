local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/transient_placement_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local original_getenv = os.getenv
local original_stderr = io.stderr
local plugin_path
local plugins
local calls
local warnings
local native_configure

before_each(function()
	plugin_path = "/test/libtransient-placement.so"
	plugins = { { name = "transient-placement" } }
	calls = { loaded = {}, configured = {}, window_rules = {} }
	warnings = {}
	native_configure = function(rules)
		table.insert(calls.configured, rules)
		return true
	end
	os.getenv = function(name)
		if name == "HYPR_TRANSIENT_PLACEMENT_PLUGIN" then
			return plugin_path
		end
		return original_getenv(name)
	end
	io.stderr = {
		write = function(_, ...)
			table.insert(warnings, table.concat({ ... }))
		end,
	}
	_G.hl = {
		plugin = {
			load = function(path)
				table.insert(calls.loaded, path)
			end,
			transient_placement = {
				configure = function(rules)
					return native_configure(rules)
				end,
			},
		},
		get_loaded_plugins = function()
			return plugins
		end,
		window_rule = function(rule)
			table.insert(calls.window_rules, rule)
		end,
		-- No late window listener or dispatcher may survive the native switch.
		on = function()
			error("late window listener is forbidden")
		end,
		dispatch = function()
			error("late positioning dispatch is forbidden")
		end,
	}
	package.loaded["rules.transient_placement"] = nil
	package.loaded["plugins.transient_placement"] = nil
end)

after_each(function()
	os.getenv = original_getenv
	io.stderr = original_stderr
	_G.hl = nil
	package.loaded["rules.transient_placement"] = nil
	package.loaded["plugins.transient_placement"] = nil
end)

it("configures only the six existing relationships with opt-in focus inference", function()
	assert.is_true(require("rules.transient_placement").register())
	assert.are.same({ plugin_path }, calls.loaded)
	local configured = calls.configured[1]
	assert.are.equal(6, #configured)
	local pairs = {}
	for _, rule in ipairs(configured) do
		assert.is_true(rule.infer_focused_parent)
		assert.is_true(rule.no_anim)
		table.insert(pairs, { rule.parent_class, rule.child_class })
	end
	assert.are.same({
		{ "app.zen_browser.zen", "app.zen_browser.zen-popup" },
		{ "helium", "helium-popup" },
		{ "nemo", "zenity" },
		{ "nemo", "org.gnome.FileRoller" },
		{ "nemo", "org.gnome.Loupe" },
		{ "md.obsidian.Obsidian", "md.obsidian.Obsidian" },
	}, pairs)
	assert.are.same({ "Settings - ", "Community plugins - " }, configured[6].child_title_prefixes)
	for i = 1, 5 do
		assert.is_nil(configured[i].child_title_prefixes)
	end
	assert.are.same({}, warnings)
end)

it("keeps Obsidian floating and sizing policy in Lua", function()
	require("rules.transient_placement").register()
	assert.are.same({
		{
			match = {
				class = "^md\\.obsidian\\.Obsidian$",
				initial_title = "^(Settings|Community plugins) - .*$",
			},
			float = true,
			size = "970 1050",
			no_anim = true,
		},
	}, calls.window_rules)
	for _, rule in ipairs(calls.configured[1]) do
		assert.is_nil(rule.size)
		assert.is_nil(rule.float)
	end
end)

it("replaces the policy when registration runs again without installing listeners", function()
	local module = require("rules.transient_placement")
	assert.is_true(module.register())
	assert.is_true(module.register())
	assert.are.equal(2, #calls.configured)
	assert.are.same(calls.configured[1], calls.configured[2])
end)

it("waits for the scheduled parse when initial plugin loading is deferred", function()
	plugins = {}
	local ok, err = require("rules.transient_placement").register()
	assert.is_false(ok)
	assert.are.equal("deferred", err)
	assert.are.same({}, calls.configured)
	assert.are.same({}, warnings)
	plugins = { { name = "transient-placement" } }
	assert.is_true(require("rules.transient_placement").register())
	assert.are.equal(1, #calls.configured)
end)

it("reports missing plugin paths without restoring late placement", function()
	plugin_path = nil
	local ok, err = require("rules.transient_placement").register()
	assert.is_false(ok)
	assert.matches("plugin path is unavailable", err)
	assert.are.same({}, calls.loaded)
	assert.are.same({}, calls.configured)
	assert.are.equal(1, #warnings)
end)

it("reports rejected native configuration", function()
	native_configure = function()
		return false, "invalid rule"
	end
	local ok, err = require("rules.transient_placement").register()
	assert.is_false(ok)
	assert.matches("invalid rule", err)
	assert.are.equal(1, #warnings)
end)

it("reports plugin load failures", function()
	hl.plugin.load = function()
		error("incompatible build")
	end
	local ok, err = require("rules.transient_placement").register()
	assert.is_false(ok)
	assert.matches("incompatible build", err)
	assert.are.same({}, calls.configured)
	assert.are.equal(1, #warnings)
end)
