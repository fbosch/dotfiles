local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/persistent_position_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local adapter = "plugins.persistent_position"
local names = { adapter, "plugins.persistent_state", "plugins.persistent_position_readiness", "runtime.lib.hypr-ipc" }

describe("native persistence adapter", function()
	local saved, old_hl, old_env, old_remove
	local env, calls, loaded, version, import_ok, configure_ok
	before_each(function()
		saved = {}
		for _, name in ipairs(names) do
			saved[name] = package.loaded[name]
		end
		package.loaded[adapter] = nil
		old_hl, old_env, old_remove = _G.hl, os.getenv, os.remove
		env = {
			HOME = "/test",
			XDG_STATE_HOME = "/test/state",
			HYPR_PERSISTENT_POSITION_PLUGIN = "/plugin.so",
			HYPR_PERSISTENT_POSITION_ENABLED = "1",
		}
		calls, loaded, version, import_ok, configure_ok = {}, true, 2, true, true
		os.getenv = function(name)
			return env[name]
		end
		os.remove = function()
			calls[#calls + 1] = "remove-ready"
			return true
		end
		package.loaded["runtime.lib.hypr-ipc"] = {
			instance_path = function()
				return "/test/ready"
			end,
		}
		package.loaded["plugins.persistent_state"] = {
			import_file = function(_, path, legacy, selectors)
				assert.equals("/test/state/hyprland/persistent-position.state", path)
				assert.equals("/test/.config/hypr/rules/window-state.lua", legacy)
				assert.equals(20, #selectors)
				calls[#calls + 1] = "import"
				assert(import_ok, "broken import")
			end,
		}
		package.loaded["plugins.persistent_position_readiness"] = {
			publish = function(_, selectors, native)
				assert.equals(20, #selectors)
				assert.is_true(native)
				calls[#calls + 1] = "ready"
			end,
		}
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
					configure = function()
						calls[#calls + 1] = "configure"
						return configure_ok, "bad configuration"
					end,
				},
			},
		}
	end)
	after_each(function()
		_G.hl, os.getenv, os.remove = old_hl, old_env, old_remove
		for _, name in ipairs(names) do
			package.loaded[name] = saved[name]
		end
	end)

	it("remains inert when explicitly disabled", function()
		env.HYPR_PERSISTENT_POSITION_ENABLED = nil
		assert.is_false(require(adapter).enabled)
		assert.same({}, calls)
	end)
	it("configures all policies after import and publishes readiness last", function()
		local result = require(adapter)
		assert.is_true(result.enabled)
		assert.is_true(result.native_state)
		assert.same({ "remove-ready", "load", "import", "configure", "ready" }, calls)
	end)
	it("waits for the plugin API registration parse", function()
		loaded = false
		assert.is_false(require(adapter).enabled)
		assert.same({ "remove-ready", "load" }, calls)
	end)
	it("reports an unsupported native API without loading old generated rules", function()
		version = 1
		local result = require(adapter)
		assert.is_false(result.enabled)
		assert.matches("API v2", result.error)
		assert.same({ "remove-ready", "load", "remove-ready" }, calls)
	end)
	it("does not publish readiness when import fails", function()
		import_ok = false
		local result = require(adapter)
		assert.is_false(result.enabled)
		assert.matches("broken import", result.error)
		assert.same({ "remove-ready", "load", "import", "remove-ready" }, calls)
	end)
	it("does not publish readiness when configuration fails", function()
		configure_ok = false
		assert.is_false(require(adapter).enabled)
		assert.same({ "remove-ready", "load", "import", "configure", "remove-ready" }, calls)
	end)
end)
