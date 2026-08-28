local module_names = {
	"lib.async",
	"lib.command",
	"runtime.lib.hypr-ipc",
	"plugins.window_interaction_hooks",
}

local original_hl = _G.hl
local original_getenv = os.getenv

describe("window interaction hooks adapter", function()
	local saved_modules
	local handlers
	local dispatches
	local deferred
	local loaded_plugin
	local rebind_calls

	before_each(function()
		saved_modules = {}
		for _, name in ipairs(module_names) do
			saved_modules[name] = {
				loaded = package.loaded[name],
				preload = package.preload[name],
			}
			package.loaded[name] = nil
		end

		handlers = {}
		dispatches = {}
		deferred = {}
		loaded_plugin = nil
		rebind_calls = 0

		package.preload["lib.async"] = function()
			return {
				defer = function(callback, delay_ms)
					table.insert(deferred, {
						callback = callback,
						delay_ms = delay_ms,
					})
				end,
			}
		end

		package.preload["lib.command"] = function()
			return {
				arg = function(value)
					return value
				end,
			}
		end

		package.preload["runtime.lib.hypr-ipc"] = function()
			return {
				instance_socket_path = function(name)
					return "/runtime/" .. name
				end,
			}
		end

		_G.hl = {
			dispatch = function(command_value)
				table.insert(dispatches, command_value)
			end,
			dsp = {
				exec_cmd = function(command_value)
					return command_value
				end,
			},
			on = function(name, callback)
				handlers[name] = callback
			end,
			plugin = {
				load = function(path)
					loaded_plugin = path
				end,
				window_interaction_hooks = {
					rebind = function()
						rebind_calls = rebind_calls + 1
						return true
					end,
				},
			},
		}

		os.getenv = function(name)
			if name == "HYPR_WINDOW_INTERACTION_HOOKS_PLUGIN" then
				return "/nix/store/window-interaction-hooks.so"
			end
			return original_getenv(name)
		end
	end)

	after_each(function()
		for _, name in ipairs(module_names) do
			package.loaded[name] = saved_modules[name].loaded
			package.preload[name] = saved_modules[name].preload
		end
		_G.hl = original_hl
		os.getenv = original_getenv
	end)

	it("loads the plugin and announces the event path", function()
		require("plugins.window_interaction_hooks")

		assert.are.equal("/nix/store/window-interaction-hooks.so", loaded_plugin)
		assert.are.equal(1, rebind_calls)
		assert.matches("interaction%-hooks%-ready", dispatches[1])
		assert.matches("/runtime/window%-state%.sock", dispatches[1])
		assert.is_function(handlers["window_interaction_hooks.finished"])
		assert.is_function(handlers["hyprland.start"])
	end)

	it("forwards valid completed interactions", function()
		require("plugins.window_interaction_hooks")

		handlers["window_interaction_hooks.finished"]({}, "move", 10, 20, 300, 200)

		assert.matches("interaction%-finished move", dispatches[#dispatches])
	end)

	it("ignores invalid interaction kinds", function()
		require("plugins.window_interaction_hooks")
		local before = #dispatches

		handlers["window_interaction_hooks.finished"]({}, "unknown", 10, 20, 300, 200)

		assert.are.equal(before, #dispatches)
	end)

	it("reannounces readiness after startup", function()
		require("plugins.window_interaction_hooks")

		handlers["hyprland.start"]()

		assert.are.equal(1, #deferred)
		assert.are.equal(1000, deferred[1].delay_ms)

		deferred[1].callback()
		assert.matches("interaction%-hooks%-ready", dispatches[#dispatches])
	end)

	it("keeps polling fallback when plugin loading fails", function()
		hl.plugin.load = function()
			error("load failed")
		end

		local adapter = require("plugins.window_interaction_hooks")

		assert.matches("polling fallback", adapter.error)
		assert.is_nil(handlers["window_interaction_hooks.finished"])
	end)
end)
