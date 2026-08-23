local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/custom_layout_resize_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local active_window
local dispatched
local animations
local command_handler
local plugin_args
local plugin_stops
local restored

local function load_module(with_plugin)
	dispatched = {}
	animations = {}
	command_handler = nil
	plugin_args = nil
	plugin_stops = 0
	restored = 0

	local plugin = nil
	if with_plugin then
		plugin = {
			start = function(...)
				plugin_args = { ... }
				return true, true
			end,
			stop = function()
				plugin_stops = plugin_stops + 1
				return true
			end,
		}
	end

	_G.hl = {
		plugin = { custom_layout_resize = plugin },
		dsp = {
			layout = function(value)
				return { op = "layout", value = value }
			end,
			window = {
				float = function()
					return { op = "float" }
				end,
				set_prop = function(args)
					return { op = "set_prop", args = args }
				end,
				resize = function()
					return { op = "resize" }
				end,
			},
		},
		dispatch = function(value)
			dispatched[#dispatched + 1] = value
		end,
		animation = function(value)
			animations[#animations + 1] = value
		end,
		on = function(name, callback)
			assert.are.equal("custom_layout_resize.command", name)
			command_handler = callback
			return { name = name }
		end,
	}

	package.loaded["lib.monitor_role"] = {
		portrait = "portrait",
		ultrawide = "ultrawide",
		for_window = function(window)
			return window and window.monitor_role
		end,
		name_for = function(role)
			return role == "portrait" and "HDMI-A-2" or "DP-2"
		end,
	}
	package.loaded["lib.window.state"] = {
		active = function()
			return active_window
		end,
		uses_any_custom_layout = function()
			return true
		end,
	}
	package.loaded["layouts.shared.order_state"] = {
		window_id = function(window)
			return window and window.address
		end,
	}
	package.loaded["layouts.shared.intents"] = {
		record_placement_intent = function() end,
	}
	package.loaded["lib.window_tags"] = { non_resizable = "non-resizable" }
	package.loaded["lib.profile_state"] = { resolved = function() return "default" end }
	package.loaded["profiles"] = { apply_current = function() restored = restored + 1 end }
	package.loaded["animations"] = { restore_windows_move = function() restored = restored + 1 end }
	package.loaded["lib.window.custom_layout"] = nil
	return require("lib.window.custom_layout")
end

before_each(function()
	active_window = {
		address = "0xabc",
		floating = false,
		workspace = { id = 2, name = "2", tiled_layout = "lua:ultrawide_master" },
		monitor_role = "ultrawide",
	}
end)

describe("custom layout resize adapter", function()
	it("delegates resize mechanics to the plugin", function()
		local custom_layout = load_module(true)

		assert.is_true(custom_layout.start_custom_layout_resize())
		assert.are.same(
			{ "lua:ultrawide_master", "lua:portrait_rows", "HDMI-A-2", "non-resizable" },
			plugin_args
		)
		assert.are.same({ leaf = "windowsMove", enabled = false }, animations[1])

		command_handler("resize-x-at address:0xabc right 420")
		assert.are.equal("layout", dispatched[#dispatched].op)
		assert.are.equal("resize-x-at address:0xabc right 420", dispatched[#dispatched].value)

		custom_layout.stop_custom_layout_resize()
		assert.are.equal(1, plugin_stops)
		assert.are.equal(1, restored)
	end)

	it("fails closed when the required plugin is unavailable", function()
		local custom_layout = load_module(false)

		assert.is_true(custom_layout.start_custom_layout_resize())
		assert.is_nil(plugin_args)
		assert.are.equal("set_prop", dispatched[#dispatched].op)
	end)
end)
