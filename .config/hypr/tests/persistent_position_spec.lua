local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/persistent_position_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local adapter = "plugins.persistent_position"

describe("native persistence adapter", function()
	local saved, old_hl, old_env
	local env, calls, loaded, version, rule_version, configure_ok
	before_each(function()
		saved = package.loaded[adapter]
		package.loaded[adapter] = nil
		old_hl, old_env = _G.hl, os.getenv
		env = {
			HOME = "/test",
			XDG_STATE_HOME = "/test/state",
			HYPR_PERSISTENT_POSITION_PLUGIN = "/plugin.so",
			HYPR_PERSISTENT_POSITION_ENABLED = "1",
		}
		calls, loaded, version, rule_version, configure_ok = {}, true, 2, 1, true
		os.getenv = function(name)
			return env[name]
		end
		_G.hl = {
			get_loaded_plugins = function()
				return loaded and { { name = "persistent-position" } } or {}
			end,
			plugin = {
				load = function()
					calls[#calls + 1] = "load"
				end,
				persistent_position = {
					state_version = function()
						return version
					end,
					rule_api_version = function()
						return rule_version
					end,
					configure = function(path, selectors)
						assert.equals("/test/state/hyprland/persistent-position.state", path)
						assert.is_nil(selectors)
						calls[#calls + 1] = "configure"
						return configure_ok, "bad configuration"
					end,
				},
			},
		}
	end)
	after_each(function()
		_G.hl, os.getenv = old_hl, old_env
		package.loaded[adapter] = saved
	end)

	it("remains inert when explicitly disabled", function()
		env.HYPR_PERSISTENT_POSITION_ENABLED = nil
		assert.is_false(require(adapter).enabled)
		assert.same({}, calls)
	end)
	it("configures storage and verifies native effects before marking native ownership active", function()
		local result = require(adapter)
		assert.is_true(result.enabled)
		assert.is_true(result.native_state)
		assert.same({ "load", "configure" }, calls)
	end)
	it("waits for the plugin API registration parse", function()
		loaded = false
		assert.is_false(require(adapter).enabled)
		assert.same({ "load" }, calls)
	end)
	it("reports an unsupported native API without loading old generated rules", function()
		version = 1
		local result = require(adapter)
		assert.is_false(result.enabled)
		assert.matches("API v2", result.error)
		assert.same({ "load" }, calls)
	end)
	it("rejects a plugin without registered native effects", function()
		rule_version = 0
		local result = require(adapter)
		assert.is_false(result.enabled)
		assert.matches("rule API v1", result.error)
		assert.same({ "load" }, calls)
	end)
	it("rejects a plugin missing the rule API capability", function()
		_G.hl.plugin.persistent_position.rule_api_version = nil
		local result = require(adapter)
		assert.is_false(result.enabled)
		assert.matches("rule API v1", result.error)
	end)
	it("reports rejected loading before persistence rules can be enabled", function()
		_G.hl.plugin.load = function()
			error("load rejected")
		end
		local result = require(adapter)
		assert.is_false(result.enabled)
		assert.matches("load rejected", result.error)
		assert.same({}, calls)
	end)
	it("does not mark native ownership active when configuration fails", function()
		configure_ok = false
		local result = require(adapter)
		assert.is_false(result.enabled)
		assert.is_nil(result.native_state)
		assert.matches("bad configuration", result.error)
		assert.same({ "load", "configure" }, calls)
	end)
end)
