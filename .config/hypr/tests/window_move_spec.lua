local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/window_move_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local dispatched = {}
local active_window = nil
local cursor_position = nil
local windows = {}
local monitors = {}
local timers = {}

_G.hl = {
	dsp = {
		exec_cmd = function(command)
			return { op = "exec_cmd", command = command }
		end,
		layout = function(value)
			return { op = "layout", value = value }
		end,
		focus = function(args)
			return { op = "focus", args = args }
		end,
		cursor = {
			move = function(args)
				return { op = "cursor.move", args = args }
			end,
		},
		window = {
			float = function(args)
				return { op = "window.float", args = args }
			end,
			move = function(args)
				return { op = "window.move", args = args }
			end,
			swap = function(args)
				return { op = "window.swap", args = args }
			end,
			resize = function(args)
				return { op = "window.resize", args = args }
			end,
			drag = function()
				return { op = "window.drag" }
			end,
		},
	},
	dispatch = function(dispatcher)
		dispatched[#dispatched + 1] = dispatcher
		if dispatcher.op == "focus" and dispatcher.args.window then
			active_window = dispatcher.args.window
		elseif dispatcher.op == "window.float" and dispatcher.args and dispatcher.args.action == "set" then
			active_window.floating = true
		end
	end,
	get_active_window = function()
		return active_window
	end,
	get_active_workspace = function()
		return active_window and active_window.workspace
	end,
	get_cursor_pos = function()
		return cursor_position
	end,
	get_windows = function()
		return windows
	end,
	get_monitors = function()
		return monitors
	end,
	timer = function(callback, options)
		timers[#timers + 1] = { callback = callback, options = options }
	end,
}

local interaction
local custom_layout
local monitor_role = require("lib.monitor_role")
local directional
local intents
local state

local function reset(monitor, x, monitor_x, workspace_windows, name)
	dispatched = {}
	active_window = {
		address = "0xactive",
		monitor = { name = monitor, x = monitor_x },
		at = { x = x or 100, y = 200 },
		size = { x = 300, y = 400 },
	}
	local layouts = {
		["DP-2"] = "lua:ultrawide_master",
		["HDMI-A-2"] = "lua:portrait_rows",
	}
	local layout = layouts[monitor]
	local workspace = { name = name or "2", tiled_layout = layout }
	active_window.workspace = workspace
	windows = { active_window }
	monitors = {}
	timers = {}
	cursor_position = nil
	if workspace_windows then
		function workspace:get_windows()
			return workspace_windows
		end

		for index = 1, #workspace_windows do
			workspace_windows[index].workspace = workspace
		end
	end
end

local function assert_equal(actual, expected, message)
	if actual ~= expected then
		error(message .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual))
	end
end

local function set_workspace_windows(layout, workspace_windows)
	active_window.workspace.tiled_layout = layout
	for index = 1, #workspace_windows do
		workspace_windows[index].workspace = active_window.workspace
	end
	function active_window.workspace:get_windows()
		return workspace_windows
	end
end

local function load_modules()
	package.loaded["lib.window.interaction"] = nil
	package.loaded["lib.window.custom_layout"] = nil
	package.loaded["lib.window.directional"] = nil
	package.loaded["lib.window.state"] = nil
	package.loaded["lib.window.workspace"] = nil
	package.loaded["layouts.shared.order_state"] = nil
	package.loaded["layouts.shared.intents"] = nil
	package.loaded["runtime.lib.hypr-ipc"] = {
		instance_path = function(name)
			return "/tmp/" .. name
		end,
		instance_socket_path = function(name)
			return "/tmp/" .. name
		end,
	}
	package.loaded["actions.picture-in-picture"] = {
		drag = function()
			hl.dispatch(hl.dsp.exec_cmd("pip drag"))
			hl.dispatch(hl.dsp.window.drag())
		end,
		finish_drag = function()
			hl.dispatch(hl.dsp.exec_cmd("pip finish-drag"))
		end,
	}
	interaction = require("lib.window.interaction")
	custom_layout = require("lib.window.custom_layout")
	directional = require("lib.window.directional")
	state = require("lib.window.state")
	intents = require("layouts.shared.intents")
end

before_each(load_modules)

local function run(name, test)
	it(name, test)
end

run("dp down moves window to portrait monitor", function()
	reset("DP-2")
	directional.move("down")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "HDMI-A-2", "target monitor")
	assert_equal(intents.transfer_intent_for_window(active_window).monitor_role, monitor_role.portrait, "transfer role")
	assert_equal(intents.transfer_intent_for_window(active_window).axis, "y", "transfer axis")
	assert_equal(intents.transfer_intent_for_window(active_window).edge, "end", "transfer edge")
	assert_equal(dispatched[2].op, "cursor.move", "cursor dispatcher")
	assert_equal(dispatched[2].args.x, 250, "cursor x")
	assert_equal(dispatched[2].args.y, 400, "cursor y")
end)

run("native layouts bypass the custom resize daemon", function()
	reset("DP-2")
	active_window.workspace.tiled_layout = "dwindle"

	assert_equal(custom_layout.start_custom_layout_resize(), false, "custom resize handled")
	assert_equal(#dispatched, 0, "dispatch count")
end)

run("floating windows bypass the custom resize daemon", function()
	reset("DP-2")
	active_window.floating = true

	assert_equal(custom_layout.start_custom_layout_resize(), false, "custom resize handled")
	assert_equal(#dispatched, 0, "dispatch count")
end)

run("ultrawide focus includes a floating window", function()
	reset("DP-2")
	active_window.visible = true
	active_window.floating = false
	local floating = {
		address = "0xfloating",
		visible = true,
		floating = true,
		at = { x = 500, y = 200 },
		size = { x = 300, y = 400 },
	}
	set_workspace_windows("lua:ultrawide_master", { active_window, floating })

	directional.focus("right")()

	assert_equal(dispatched[1].op, "focus", "dispatcher")
	assert_equal(dispatched[1].args.window, floating, "floating focus target")
end)

run("portrait focus includes a tiled window from a floating window", function()
	reset("HDMI-A-2")
	active_window.visible = true
	active_window.floating = true
	local tiled = {
		address = "0xtiled",
		visible = true,
		floating = false,
		at = { x = 100, y = 700 },
		size = { x = 300, y = 400 },
	}
	set_workspace_windows("lua:portrait_rows", { active_window, tiled })

	directional.focus("down")()

	assert_equal(dispatched[1].op, "focus", "dispatcher")
	assert_equal(dispatched[1].args.window, tiled, "tiled focus target")
end)

run("portrait right focus crosses to the nearest ultrawide window", function()
	reset("HDMI-A-2")
	active_window.visible = true
	set_workspace_windows("lua:portrait_rows", { active_window })
	local far = {
		visible = true,
		monitor = { name = "DP-2" },
		at = { x = 3000, y = 200 },
		size = { x = 300, y = 400 },
		workspace = { name = "2" },
	}
	local near = {
		visible = true,
		monitor = { name = "DP-2" },
		at = { x = 1800, y = 200 },
		size = { x = 300, y = 400 },
		workspace = { name = "2" },
	}
	windows = { active_window, far, near }

	directional.focus("right")()

	assert_equal(dispatched[1].args.window, near, "ultrawide focus target")
end)

run("ultrawide left focus crosses to the nearest portrait window", function()
	reset("DP-2", 2000)
	active_window.visible = true
	set_workspace_windows("lua:ultrawide_master", { active_window })
	local far = {
		visible = true,
		monitor = { name = "HDMI-A-2" },
		at = { x = 100, y = 200 },
		size = { x = 300, y = 400 },
		workspace = { name = "1" },
	}
	local near = {
		visible = true,
		monitor = { name = "HDMI-A-2" },
		at = { x = 1000, y = 200 },
		size = { x = 300, y = 400 },
		workspace = { name = "1" },
	}
	windows = { active_window, far, near }

	directional.focus("left")()

	assert_equal(dispatched[1].args.window, near, "portrait focus target")
end)

run("custom layout focus chooses the nearest mixed-state candidate", function()
	reset("DP-2")
	active_window.visible = true
	local near_floating = {
		visible = true,
		floating = true,
		at = { x = 500, y = 200 },
		size = { x = 300, y = 400 },
	}
	local far_tiled = {
		visible = true,
		floating = false,
		at = { x = 900, y = 200 },
		size = { x = 300, y = 400 },
	}
	set_workspace_windows("lua:ultrawide_master", { active_window, far_tiled, near_floating })

	directional.focus("right")()

	assert_equal(dispatched[1].args.window, near_floating, "nearest focus target")
end)

run("custom layout focus excludes opposite-side candidates", function()
	reset("DP-2")
	active_window.visible = true
	local near_floating_left = {
		visible = true,
		floating = true,
		at = { x = -200, y = 200 },
		size = { x = 300, y = 400 },
	}
	local far_tiled_right = {
		visible = true,
		floating = false,
		at = { x = 900, y = 200 },
		size = { x = 300, y = 400 },
	}
	set_workspace_windows("lua:ultrawide_master", { active_window, near_floating_left, far_tiled_right })

	directional.focus("right")()

	assert_equal(dispatched[1].args.window, far_tiled_right, "directional focus target")
end)

run("custom layout focus ignores invisible and incomplete candidates", function()
	reset("DP-2")
	active_window.visible = true
	local invisible = {
		visible = false,
		at = { x = 300, y = 200 },
		size = { x = 300, y = 400 },
	}
	local incomplete = { visible = true, at = { x = 400, y = 200 } }
	local valid = {
		visible = true,
		at = { x = 600, y = 200 },
		size = { x = 300, y = 400 },
	}
	set_workspace_windows("lua:ultrawide_master", { active_window, invisible, incomplete, valid })

	directional.focus("right")()

	assert_equal(dispatched[1].args.window, valid, "usable focus target")
end)

run("custom layout focus falls back to native focus without a directional candidate", function()
	reset("DP-2")
	active_window.visible = true
	local left = {
		visible = true,
		at = { x = -200, y = 200 },
		size = { x = 300, y = 400 },
	}
	set_workspace_windows("lua:ultrawide_master", { active_window, left })

	directional.focus("right")()

	assert_equal(dispatched[1].args.direction, "right", "native focus direction")
end)

run("non-custom layout focus remains native", function()
	reset("DP-2", nil, nil, nil, "11")
	active_window.visible = true
	local floating = {
		visible = true,
		floating = true,
		at = { x = 500, y = 200 },
		size = { x = 300, y = 400 },
	}
	set_workspace_windows("master", { active_window, floating })

	directional.focus("right")()

	assert_equal(dispatched[1].args.direction, "right", "native focus direction")
end)

run("picture-in-picture focus retains its tiled-only override", function()
	package.loaded["actions.picture-in-picture"] = nil
	package.loaded["lib.window.directional"] = nil
	directional = require("lib.window.directional")
	reset("DP-2")
	active_window.class = "app.zen_browser.zen"
	active_window.title = "Picture-in-Picture"
	active_window.visible = true
	active_window.floating = true
	local floating = {
		visible = true,
		floating = true,
		at = { x = 500, y = 200 },
		size = { x = 300, y = 400 },
	}
	local tiled = {
		visible = true,
		floating = false,
		at = { x = 900, y = 200 },
		size = { x = 300, y = 400 },
	}
	windows = { active_window, floating, tiled }
	set_workspace_windows("lua:ultrawide_master", windows)

	directional.focus("right")()

	assert_equal(dispatched[1].args.window, tiled, "PiP focus target")
end)

run("cursor lookup selects an unfocused normal window beside a game", function()
	reset("DP-2")
	active_window = {
		content_type = "game",
		visible = true,
		at = { x = 1440, y = 0 },
		size = { x = 3440, y = 1440 },
	}
	local normal_window = {
		content_type = "none",
		visible = true,
		at = { x = 0, y = 0 },
		size = { x = 1428, y = 830 },
	}
	windows = { active_window, normal_window }
	cursor_position = { x = 700, y = 400 }

	assert_equal(state.at_cursor(), normal_window, "window under cursor")
end)

run("active-window tag predicate skips tagged windows", function()
	reset("DP-2")
	active_window.tags = { "passthrough-exempt*" }

	assert_equal(state.active_is_not_tagged("passthrough-exempt")(), false, "tagged window")
	active_window.tags = nil
	assert_equal(state.active_is_not_tagged("passthrough-exempt")(), true, "untagged window")
end)

run("cursor lookup ignores games on inactive workspaces", function()
	reset("DP-2")
	active_window.content_type = "none"
	active_window.visible = true
	active_window.at = { x = 0, y = 0 }
	active_window.size = { x = 1428, y = 830 }
	local game_window = {
		content_type = "game",
		visible = true,
		workspace = { name = "10" },
		at = { x = 0, y = 0 },
		size = { x = 3440, y = 1440 },
	}
	windows = { game_window, active_window }
	cursor_position = { x = 700, y = 400 }

	assert_equal(state.at_cursor(), active_window, "window on active workspace")
end)

run("drag targets the normal cursor window instead of the active game", function()
	reset("DP-2")
	active_window = {
		content_type = "game",
		visible = true,
		at = { x = 1440, y = 0 },
		size = { x = 3440, y = 1440 },
	}
	local normal_window = {
		content_type = "none",
		visible = true,
		at = { x = 0, y = 0 },
		size = { x = 1428, y = 830 },
	}
	windows = { active_window, normal_window }
	cursor_position = { x = 700, y = 400 }

	assert_equal(interaction.start_drag(), true, "drag starts")
	assert_equal(dispatched[1].op, "exec_cmd", "PiP drag dispatcher")
	assert_equal(dispatched[2].op, "window.drag", "drag dispatcher")
	assert_equal(interaction.finish_drag(custom_layout), true, "drag finishes")
	assert_equal(dispatched[3].op, "exec_cmd", "finish drag dispatcher")
end)

run("custom layout drag places the active window after interactive dragging", function()
	reset("DP-2")
	active_window.workspace.tiled_layout = "lua:ultrawide_master"
	cursor_position = { x = 250, y = 400 }

	assert_equal(interaction.start_drag(), true, "drag starts")
	assert_equal(dispatched[1].op, "exec_cmd", "PiP drag dispatcher")
	assert_equal(dispatched[2].op, "window.drag", "drag dispatcher")
	assert_equal(interaction.finish_drag(custom_layout), true, "drag finishes")
	assert_equal(dispatched[3].op, "layout", "layout dispatcher")
	assert_equal(dispatched[4].op, "exec_cmd", "finish drag dispatcher")
end)

run("drag keeps an already floating window floating", function()
	reset("DP-2")
	active_window.floating = true

	assert_equal(interaction.start_drag(), true, "drag starts")
	assert_equal(dispatched[1].op, "exec_cmd", "PiP drag dispatcher")
	assert_equal(dispatched[2].op, "window.drag", "drag dispatcher")
	assert_equal(interaction.finish_drag(custom_layout), true, "drag finishes")
	assert_equal(dispatched[3].op, "layout", "layout dispatcher")
	assert_equal(dispatched[4].op, "exec_cmd", "finish drag dispatcher")
end)

run("float toggle records ultrawide window center before tiling", function()
	reset("DP-2", 700)
	active_window.floating = true
	active_window.workspace.tiled_layout = "lua:ultrawide_master"

	custom_layout.toggle_float()

	local intent = intents.placement_intent_for_window(active_window)
	assert_equal(intent.layout_name, "ultrawide_master", "layout name")
	assert_equal(intent.workspace_key, "2", "workspace key")
	assert_equal(intent.axis, "x", "layout axis")
	assert_equal(intent.position, 850, "window center")
	assert_equal(dispatched[1].op, "window.float", "float dispatcher")
	assert_equal(timers[1].options.timeout, 2000, "intent timeout")
end)

run("float toggle records portrait window center before tiling", function()
	reset("HDMI-A-2")
	active_window.floating = true
	active_window.at.y = 500
	active_window.workspace.tiled_layout = "lua:portrait_rows"

	custom_layout.toggle_float()

	local intent = intents.placement_intent_for_window(active_window)
	assert_equal(intent.layout_name, "portrait_rows", "layout name")
	assert_equal(intent.axis, "y", "layout axis")
	assert_equal(intent.position, 700, "window center")
	assert_equal(dispatched[1].op, "window.float", "float dispatcher")
end)

run("float toggle falls through without placement intent", function()
	reset("DP-2")
	active_window.floating = true
	active_window.workspace.tiled_layout = "master"

	custom_layout.toggle_float()

	assert_equal(intents.placement_intent_for_window(active_window), nil, "placement intent")
	assert_equal(dispatched[1].op, "window.float", "float dispatcher")
end)

run("float toggle falls through without complete geometry", function()
	reset("DP-2")
	active_window.floating = true
	active_window.size = nil

	custom_layout.toggle_float()

	assert_equal(intents.placement_intent_for_window(active_window), nil, "placement intent")
	assert_equal(dispatched[1].op, "window.float", "float dispatcher")
end)

run("float toggle falls through without stable identity", function()
	reset("DP-2")
	active_window.floating = true
	active_window.address = nil
	active_window.stable_id = nil

	custom_layout.toggle_float()

	assert_equal(intents.placement_intent_for_window(active_window), nil, "placement intent")
	assert_equal(dispatched[1].op, "window.float", "float dispatcher")
end)

run("tiled to floating does not record placement intent", function()
	reset("DP-2")
	active_window.floating = false

	custom_layout.toggle_float()

	assert_equal(intents.placement_intent_for_window(active_window), nil, "placement intent")
	assert_equal(dispatched[1].op, "window.float", "float dispatcher")
end)

run("float placement intent expires", function()
	reset("DP-2")
	active_window.floating = true

	custom_layout.toggle_float()
	timers[1].callback()

	assert_equal(intents.placement_intent_for_window(active_window), nil, "expired intent")
end)

run("dp left edge moves window to portrait monitor", function()
	reset("DP-2", 1446)
	directional.move("left")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "HDMI-A-2", "target monitor")
	assert_equal(intents.transfer_intent_for_window(active_window).monitor_role, monitor_role.portrait, "transfer role")
	assert_equal(intents.transfer_intent_for_window(active_window).axis, "y", "transfer axis")
	assert_equal(intents.transfer_intent_for_window(active_window).edge, "end", "transfer edge")
	assert_equal(dispatched[2].op, "cursor.move", "cursor dispatcher")
end)

run("dp left edge uses monitor x when available", function()
	reset("DP-2", 2006, 2000)
	directional.move("left")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "HDMI-A-2", "target monitor")
end)

run("dp non-left edge swaps left", function()
	reset("DP-2", 3000)
	directional.move("left")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapprev", "layout message")
	assert_equal(dispatched[2].op, "cursor.move", "cursor dispatcher")
end)

run("floating dp window moves left to portrait without transfer intent", function()
	reset("DP-2", 3000)
	active_window.floating = true
	active_window.workspace.tiled_layout = "lua:ultrawide_master"

	directional.move("left")()

	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "HDMI-A-2", "target monitor")
	assert_equal(intents.transfer_intent_for_window(active_window), nil, "transfer intent")
end)

run("floating window preserves its relative position across monitors", function()
	reset("DP-2", 2128)
	active_window.floating = true
	active_window.at.y = 788
	active_window.workspace.tiled_layout = "lua:ultrawide_master"
	monitors = {
		{ name = "DP-2", x = 1440, y = 500, width = 3440, height = 1440 },
		{ name = "HDMI-A-2", x = 0, y = 0, width = 2560, height = 1440, transform = 3 },
	}

	directional.move("left")()

	assert_equal(dispatched[1].args.monitor, "HDMI-A-2", "target monitor")
	assert_equal(dispatched[2].op, "window.move", "position dispatcher")
	assert_equal(dispatched[2].args.x, 288, "relative x")
	assert_equal(dispatched[2].args.y, 512, "relative y")
end)

run("floating window position stays inside the destination monitor", function()
	reset("DP-2", 4708)
	active_window.floating = true
	active_window.at.y = 1868
	active_window.workspace.tiled_layout = "lua:ultrawide_master"
	monitors = {
		{ name = "DP-2", x = 1440, y = 500, width = 3440, height = 1440 },
		{ name = "HDMI-A-2", x = 0, y = 0, width = 2560, height = 1440, transform = 3 },
	}

	directional.move("left")()

	assert_equal(dispatched[2].args.x, 1140, "clamped x")
	assert_equal(dispatched[2].args.y, 2160, "clamped y")
end)

run("oversized floating window is positioned for maximum visibility", function()
	reset("DP-2", 4708)
	active_window.floating = true
	active_window.at.y = 1868
	active_window.size = { x = 2000, y = 3000 }
	active_window.workspace.tiled_layout = "lua:ultrawide_master"
	monitors = {
		{ name = "DP-2", x = 1440, y = 500, width = 3440, height = 1440 },
		{ name = "HDMI-A-2", x = 0, y = 0, width = 2560, height = 1440, transform = 3 },
	}

	directional.move("left")()

	assert_equal(dispatched[2].args.x, 0, "clamped oversized x")
	assert_equal(dispatched[2].args.y, 0, "clamped oversized y")
end)

run("dp outside monitor edge tolerance swaps left", function()
	reset("DP-2", 2100, 2000)
	directional.move("left")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapprev", "layout message")
end)

run("dp only tiled window moves left to portrait", function()
	local only = { visible = true, floating = false }
	reset("DP-2", 2100, 2000, { only })
	active_window.visible = only.visible
	active_window.floating = only.floating
	active_window.workspace = only.workspace
	directional.move("left")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "HDMI-A-2", "target monitor")
	assert_equal(intents.transfer_intent_for_window(active_window).monitor_role, monitor_role.portrait, "transfer role")
end)

run("dp multiple tiled windows still swap left", function()
	local first = { visible = true, floating = false }
	local second = { visible = true, floating = false }
	reset("DP-2", 2100, 2000, { first, second })
	active_window.visible = first.visible
	active_window.floating = first.floating
	active_window.workspace = first.workspace
	directional.move("left")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapprev", "layout message")
end)

run("dp right uses ultrawide layout swap", function()
	reset("DP-2")
	directional.move("right")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapnext", "layout message")
	assert_equal(dispatched[2].op, "cursor.move", "cursor dispatcher")
end)

run("dp scrolling workspace uses native move", function()
	reset("DP-2", nil, nil, nil, "10")
	active_window.workspace.tiled_layout = "master"
	directional.move("right")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.direction, "right", "move direction")
end)

run("floating window on a master workspace uses native movement", function()
	reset("DP-2", 3000, nil, nil, "11")
	active_window.floating = true
	active_window.workspace.tiled_layout = "master"

	directional.move("left")()

	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.direction, "left", "move direction")
end)

run("hdmi right moves window to ultrawide monitor", function()
	reset("HDMI-A-2")
	directional.move("right")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "DP-2", "target monitor")
	assert_equal(
		intents.transfer_intent_for_window(active_window).monitor_role,
		monitor_role.ultrawide,
		"transfer role"
	)
	assert_equal(intents.transfer_intent_for_window(active_window).axis, "x", "transfer axis")
	assert_equal(intents.transfer_intent_for_window(active_window).edge, "start", "transfer edge")
end)

run("floating hdmi window moves right to ultrawide without transfer intent", function()
	reset("HDMI-A-2")
	active_window.floating = true
	active_window.workspace.tiled_layout = "lua:portrait_rows"

	directional.move("right")()

	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "DP-2", "target monitor")
	assert_equal(intents.transfer_intent_for_window(active_window), nil, "transfer intent")
end)

run("hdmi down uses portrait layout swap", function()
	reset("HDMI-A-2")
	directional.move("down")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapnext", "layout message")
end)

run("hdmi up uses portrait layout swap", function()
	reset("HDMI-A-2")
	directional.move("up")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapprev", "layout message")
end)

run("non-special resize uses window resize dispatcher", function()
	reset("DP-1")
	directional.adjust("resize", "right")()
	assert_equal(dispatched[1].op, "window.resize", "dispatcher")
	assert_equal(dispatched[1].args.x, 32, "resize x")
end)
