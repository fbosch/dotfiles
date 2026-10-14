local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/window_interaction_hooks_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local module_names = {
	"lib.async",
	"lib.command",
	"runtime.lib.hypr-ipc",
	"plugins.window_interaction_hooks",
	"lib.window.custom_layout",
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
	local supports_updates
	local drop_requests
	local captured_window
	local current_window
	local epoch

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
		supports_updates = true
		drop_requests = {}
		captured_window = { address = "0xcaptured" }
		current_window = captured_window
		epoch = "generation-1"

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

		package.preload["lib.window.custom_layout"] = function()
			return {
				request_drop = function(...)
					table.insert(drop_requests, { ... })
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
					supports_target_handles = function()
						return true
					end,
					capture_at_cursor = function()
						return captured_window, epoch
					end,
					capture_window = function(window)
						return window, epoch
					end,
					resolve_target = function(window, generation)
						if window == captured_window and generation == epoch then
							return current_window
						end
					end,
					rebind = function()
						rebind_calls = rebind_calls + 1
						return true
					end,
					supports_updates = function()
						return supports_updates
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

	it("loads the plugin and announces only the PiP update path", function()
		require("plugins.window_interaction_hooks")

		assert.are.equal("/nix/store/window-interaction-hooks.so", loaded_plugin)
		assert.are.equal(1, rebind_calls)
		assert.are.equal(1, #dispatches)
		assert.matches("interaction%-updates%-ready", dispatches[1])
		assert.matches("/runtime/pip%-monitor%.sock", dispatches[1])
		assert.is_nil(handlers["window_interaction_hooks.finished"])
		assert.is_function(handlers["window_interaction_hooks.dropped"])
		assert.is_function(handlers["hyprland.start"])
	end)

	it("forwards the native target, destination workspace, and release point", function()
		require("plugins.window_interaction_hooks")
		local window = { address = "0xdragged" }
		local workspace = { id = 7 }

		handlers["window_interaction_hooks.dropped"](window, workspace, 120, 340)

		assert.same({ { window, workspace, 120, 340 } }, drop_requests)
	end)

	it("reannounces readiness after startup", function()
		require("plugins.window_interaction_hooks")

		handlers["hyprland.start"]()

		assert.are.equal(1, #deferred)
		assert.are.equal(1000, deferred[1].delay_ms)

		deferred[1].callback()
		assert.matches("interaction%-updates%-ready", dispatches[#dispatches])
	end)

	it("retains PiP polling when an older plugin lacks live updates", function()
		hl.plugin.window_interaction_hooks.supports_updates = nil

		require("plugins.window_interaction_hooks")

		assert.are.equal(0, #dispatches)
	end)

	it("keeps polling fallback when the plugin path is unavailable", function()
		os.getenv = function(name)
			if name == "HYPR_WINDOW_INTERACTION_HOOKS_PLUGIN" then
				return nil
			end
			return original_getenv(name)
		end

		local adapter = require("plugins.window_interaction_hooks")

		assert.matches("polling fallback", adapter.error)
		assert.is_nil(loaded_plugin)
		assert.is_nil(handlers["window_interaction_hooks.finished"])
	end)

	it("keeps polling fallback when plugin loading fails", function()
		hl.plugin.load = function()
			error("load failed")
		end

		local adapter = require("plugins.window_interaction_hooks")

		assert.matches("polling fallback", adapter.error)
		assert.is_nil(handlers["window_interaction_hooks.finished"])
	end)
	it("captures native identity and resolves the current window at release", function()
		local adapter = require("plugins.window_interaction_hooks")
		assert.is_true(adapter.enabled)
		local target = adapter.capture_at_cursor()
		assert.equal(captured_window, target.window)
		current_window = { address = "0xcaptured", title = "latest" }
		assert.equal(current_window, target:resolve())
		current_window = nil
		assert.is_nil(target:resolve())
	end)

	it("captures an explicitly supplied fallback and preserves an empty hit", function()
		local adapter = require("plugins.window_interaction_hooks")
		assert.equal(captured_window, adapter.capture_window(captured_window):resolve())
		captured_window = nil
		assert.is_nil(adapter.capture_at_cursor())
		assert.is_nil(adapter.capture_window(nil))
	end)

	it("rejects retained handles after unload and a new generation", function()
		local adapter = require("plugins.window_interaction_hooks")
		local target = adapter.capture_at_cursor()
		local api = hl.plugin.window_interaction_hooks
		hl.plugin.window_interaction_hooks = nil
		assert.is_nil(target:resolve())
		hl.plugin.window_interaction_hooks = api
		epoch = "generation-2"
		assert.is_nil(target:resolve())
		assert.equal(current_window, adapter.capture_at_cursor():resolve())
	end)

	it("disables pointer actions when target support is missing or rejected", function()
		hl.plugin.window_interaction_hooks.capture_at_cursor = nil
		local adapter = require("plugins.window_interaction_hooks")
		assert.is_false(adapter.enabled)
		assert.is_nil(adapter.capture_at_cursor())
		assert.matches("target%-handle API", adapter.error)
	end)

	it("disables pointer actions when capability probing fails", function()
		hl.plugin.window_interaction_hooks.supports_target_handles = function()
			error("unavailable")
		end
		local adapter = require("plugins.window_interaction_hooks")
		assert.is_false(adapter.enabled)
		assert.is_nil(adapter.capture_window(captured_window))
	end)
end)
