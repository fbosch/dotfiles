local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/custom_layout_pointer_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local active_window = nil
local animations = {}
local dispatched = {}
local events = {}
local plugin_start_count = 0
local plugin_stop_count = 0
local plugin_start_result = true
local restored_animation_count = 0
local sequence = 0
local windows = {}
local cursor = nil

_G.hl = {
	plugin = {},
	dsp = {
		exec_cmd = function(command)
			return { op = "exec_cmd", command = command }
		end,
		focus = function(args)
			return { op = "focus", args = args }
		end,
		layout = function(value)
			return { op = "layout", value = value }
		end,
		window = {
			float = function()
				return { op = "window.float" }
			end,
			resize = function()
				return { op = "window.resize" }
			end,
			set_prop = function(args)
				return { op = "window.set_prop", args = args }
			end,
		},
	},
	dispatch = function(dispatcher)
		dispatched[#dispatched + 1] = dispatcher
		if dispatcher.op == "focus" then
			active_window = dispatcher.args.window
		end
	end,
	animation = function(config)
		animations[#animations + 1] = config
	end,
	get_active_window = function()
		return active_window
	end,
	get_active_workspace = function()
		return active_window and active_window.workspace or nil
	end,
	get_cursor_pos = function()
		return cursor
	end,
	get_windows = function()
		return windows
	end,
	on = function(name, callback)
		events[name] = callback
	end,
}

local custom_layout

local function plugin_api()
	return {
		start = function()
			plugin_start_count = plugin_start_count + 1
			return plugin_start_result
		end,
		stop = function()
			plugin_stop_count = plugin_stop_count + 1
			return true
		end,
	}
end

local function load_modules(plugin_available)
	package.loaded["lib.window.custom_layout"] = nil
	package.loaded["lib.window.state"] = nil
	package.loaded["layouts.shared.order_state"] = {
		window_id = function(window)
			return window and window.address and "address:" .. window.address or nil
		end,
	}
	package.loaded["layouts.shared.intents"] = {
		record_placement_intent = function() end,
	}
	package.loaded["lib.profile_state"] = {
		resolved = function()
			return "default"
		end,
	}
	package.loaded["animations"] = {
		restore_windows_move = function()
			restored_animation_count = restored_animation_count + 1
		end,
	}
	package.loaded["profiles"] = {
		apply_current = function()
			restored_animation_count = restored_animation_count + 1
		end,
	}
	package.loaded["runtime.lib.hypr-ipc"] = {
		instance_path = function(name)
			return "/tmp/" .. name
		end,
	}
	package.loaded["runtime.windows.daemons.custom-layout-drag-resize.control-protocol"] = {
		next_sequence = function()
			sequence = sequence + 1
			return sequence
		end,
	}
	package.loaded["plugins.custom_layout_pointer"] = {
		api = function()
			return plugin_available and plugin_api() or nil
		end,
		available = function()
			return plugin_available
		end,
	}

	require("lib.window.state")
	custom_layout = require("lib.window.custom_layout")
end

local function reset_window()
	local workspace = { name = "2", tiled_layout = "lua:ultrawide_master" }
	active_window = {
		address = "0xaaa",
		at = { x = 100, y = 100 },
		floating = false,
		focus_history_id = 0,
		monitor = { name = "DP-2" },
		size = { x = 600, y = 400 },
		tags = {},
		visible = true,
		workspace = workspace,
	}
	windows = { active_window }
	cursor = { x = 650, y = 200 }
end

local function dispatched_values(op)
	local values = {}
	for _, dispatcher in ipairs(dispatched) do
		if dispatcher.op == op then
			values[#values + 1] = dispatcher.value or dispatcher.command
		end
	end
	return values
end

before_each(function()
	animations = {}
	dispatched = {}
	events = {}
	plugin_start_count = 0
	plugin_stop_count = 0
	plugin_start_result = true
	restored_animation_count = 0
	sequence = 0
	reset_window()
end)

it("forwards plugin motion to the active custom layout", function()
	load_modules(true)

	assert.is_true(custom_layout.start_custom_layout_resize())
	assert.are.equal(1, plugin_start_count)
	assert.are.same({ leaf = "windowsMove", enabled = false }, animations[1])
	assert.is_function(events["custom_layout_pointer.motion"])

	events["custom_layout_pointer.motion"](701.8, 240)
	events["custom_layout_pointer.motion"](701.2, 260)

	local layouts = dispatched_values("layout")
	assert.are.equal("resize-x-at address:0xaaa right 701", layouts[1])
	assert.are.equal(1, #layouts)

	custom_layout.stop_custom_layout_resize()
	layouts = dispatched_values("layout")
	assert.are.equal("save-resize", layouts[2])
	assert.are.equal(1, plugin_stop_count)
	assert.are.equal(1, restored_animation_count)
end)

it("uses vertical motion for portrait rows", function()
	active_window.monitor = { name = "HDMI-A-2" }
	active_window.workspace.tiled_layout = "lua:portrait_rows"
	cursor = { x = 200, y = 450 }
	load_modules(true)

	assert.is_true(custom_layout.start_custom_layout_resize())
	events["custom_layout_pointer.motion"](900, 477.9)

	local layouts = dispatched_values("layout")
	assert.are.equal("resize-y-at address:0xaaa down 477", layouts[1])
end)

it("uses vertical motion for the ultrawide layout on the portrait monitor", function()
	active_window.monitor = { name = "HDMI-A-2" }
	cursor = { x = 200, y = 450 }
	load_modules(true)

	assert.is_true(custom_layout.start_custom_layout_resize())
	events["custom_layout_pointer.motion"](900, 488.4)

	local layouts = dispatched_values("layout")
	assert.are.equal("resize-y-at address:0xaaa down 488", layouts[1])
end)

it("prefers an overlapping floating window when the active window is elsewhere", function()
	local tiled = {
		address = "0xtiled",
		at = { x = 800, y = 120 },
		floating = false,
		focus_history_id = 1,
		mapped = true,
		monitor = { name = "DP-2" },
		size = { x = 300, y = 300 },
		tags = {},
		visible = true,
		workspace = active_window.workspace,
	}
	local floating = {
		address = "0xbbb",
		at = { x = 800, y = 120 },
		floating = true,
		focus_history_id = 5,
		mapped = true,
		monitor = { name = "DP-2" },
		size = { x = 300, y = 300 },
		tags = {},
		visible = true,
		workspace = active_window.workspace,
	}
	windows = { active_window, tiled, floating }
	cursor = { x = 850, y = 200 }
	load_modules(true)

	assert.is_false(custom_layout.start_custom_layout_resize())
	assert.are.equal(floating, active_window)
	assert.are.equal(0, plugin_start_count)
end)

it("keeps non-resizable windows on the plugin path without starting the daemon", function()
	active_window.tags = { "non-resizable" }
	load_modules(true)

	assert.is_true(custom_layout.start_custom_layout_resize())
	custom_layout.stop_custom_layout_resize()

	assert.are.equal(0, plugin_start_count)
	assert.are.equal(0, #animations)
	assert.are.equal(0, #dispatched_values("exec_cmd"))
end)

it("falls back to the existing daemon when the plugin is unavailable", function()
	load_modules(false)

	assert.is_true(custom_layout.start_custom_layout_resize())
	custom_layout.stop_custom_layout_resize()

	local commands = dispatched_values("exec_cmd")
	assert.are.equal(2, #commands)
	assert.is_truthy(commands[1]:find("custom-layout-drag-resize.sh start 1", 1, true))
	assert.is_truthy(commands[2]:find("custom-layout-drag-resize.sh stop 2", 1, true))
end)

it("restores animation and falls back when the plugin refuses to start", function()
	plugin_start_result = false
	load_modules(true)

	assert.is_true(custom_layout.start_custom_layout_resize())
	custom_layout.stop_custom_layout_resize()

	local commands = dispatched_values("exec_cmd")
	assert.are.equal(1, plugin_start_count)
	assert.are.equal(0, plugin_stop_count)
	assert.are.equal(1, restored_animation_count)
	assert.are.equal(2, #commands)
	assert.is_truthy(commands[1]:find("custom-layout-drag-resize.sh start 1", 1, true))
	assert.is_truthy(commands[2]:find("custom-layout-drag-resize.sh stop 2", 1, true))
end)
