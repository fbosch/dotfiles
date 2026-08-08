local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/window_move_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local dispatched = {}
local active_window = nil
local cursor_position = nil
local windows = {}
local pip_drag_target = nil

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
}

local interaction
local custom_layout
local monitor_role = require("lib.monitor_role")
local directional
local order_state
local state

local function reset(monitor, x, monitor_x, workspace_windows, name)
	dispatched = {}
	active_window = {
		address = "0xactive",
		monitor = { name = monitor, x = monitor_x },
		at = { x = x or 100, y = 200 },
		size = { x = 300, y = 400 },
	}
	local workspace = { name = name or "2" }
	active_window.workspace = workspace
	windows = { active_window }
	cursor_position = nil
	pip_drag_target = nil
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

local function load_modules()
	package.loaded["lib.window.interaction"] = nil
	package.loaded["lib.window.custom_layout"] = nil
	package.loaded["lib.window.directional"] = nil
	package.loaded["lib.window.state"] = nil
	package.loaded["lib.window.workspace"] = nil
	package.loaded["layouts.shared.order_state"] = nil
	package.loaded["runtime.lib.hypr-ipc"] = {
		instance_path = function(name)
			return "/tmp/" .. name
		end,
	}
	package.loaded["actions.picture-in-picture"] = {
		drag = function(target)
			pip_drag_target = target
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
	order_state = require("layouts.shared.order_state")
end

before_each(load_modules)

local function run(name, test)
	it(name, test)
end

run("dp down moves window to portrait monitor", function()
	reset("DP-2")
	directional.move(state, "down")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "HDMI-A-2", "target monitor")
	assert_equal(
		order_state.transfer_intent_for_window(active_window).monitor_role,
		monitor_role.portrait,
		"transfer role"
	)
	assert_equal(order_state.transfer_intent_for_window(active_window).axis, "y", "transfer axis")
	assert_equal(order_state.transfer_intent_for_window(active_window).edge, "end", "transfer edge")
	assert_equal(dispatched[2].op, "cursor.move", "cursor dispatcher")
	assert_equal(dispatched[2].args.x, 250, "cursor x")
	assert_equal(dispatched[2].args.y, 400, "cursor y")
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

	assert_equal(interaction.start_drag(state), true, "drag starts")
	assert_equal(pip_drag_target, normal_window, "PiP drag target")
	assert_equal(dispatched[2].op, "window.drag", "drag dispatcher")
	assert_equal(interaction.finish_drag(state, custom_layout), true, "drag finishes")
end)

run("custom layout drag places the active window after interactive dragging", function()
	reset("DP-2")
	active_window.workspace.tiledLayout = "lua:ultrawide_master"
	cursor_position = { x = 250, y = 400 }

	assert_equal(interaction.start_drag(state), true, "drag starts")
	assert_equal(dispatched[2].op, "window.drag", "drag dispatcher")
	assert_equal(interaction.finish_drag(state, custom_layout), true, "drag finishes")
	assert_equal(dispatched[3].op, "layout", "layout dispatcher")
	assert_equal(dispatched[3].value, "place-at-cursor", "layout message")
end)

run("dp left edge moves window to portrait monitor", function()
	reset("DP-2", 1446)
	directional.move(state, "left")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "HDMI-A-2", "target monitor")
	assert_equal(
		order_state.transfer_intent_for_window(active_window).monitor_role,
		monitor_role.portrait,
		"transfer role"
	)
	assert_equal(order_state.transfer_intent_for_window(active_window).axis, "y", "transfer axis")
	assert_equal(order_state.transfer_intent_for_window(active_window).edge, "end", "transfer edge")
	assert_equal(dispatched[2].op, "cursor.move", "cursor dispatcher")
end)

run("dp left edge uses monitor x when available", function()
	reset("DP-2", 2006, 2000)
	directional.move(state, "left")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "HDMI-A-2", "target monitor")
end)

run("dp non-left edge swaps left", function()
	reset("DP-2", 3000)
	directional.move(state, "left")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapprev", "layout message")
	assert_equal(dispatched[2].op, "cursor.move", "cursor dispatcher")
end)

run("dp outside monitor edge tolerance swaps left", function()
	reset("DP-2", 2100, 2000)
	directional.move(state, "left")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapprev", "layout message")
end)

run("dp only tiled window moves left to portrait", function()
	local only = { visible = true, floating = false }
	reset("DP-2", 2100, 2000, { only })
	active_window.visible = only.visible
	active_window.floating = only.floating
	active_window.workspace = only.workspace
	directional.move(state, "left")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "HDMI-A-2", "target monitor")
	assert_equal(
		order_state.transfer_intent_for_window(active_window).monitor_role,
		monitor_role.portrait,
		"transfer role"
	)
end)

run("dp multiple tiled windows still swap left", function()
	local first = { visible = true, floating = false }
	local second = { visible = true, floating = false }
	reset("DP-2", 2100, 2000, { first, second })
	active_window.visible = first.visible
	active_window.floating = first.floating
	active_window.workspace = first.workspace
	directional.move(state, "left")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapprev", "layout message")
end)

run("dp right uses ultrawide layout swap", function()
	reset("DP-2")
	directional.move(state, "right")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapnext", "layout message")
	assert_equal(dispatched[2].op, "cursor.move", "cursor dispatcher")
end)

run("dp scrolling workspace uses native move", function()
	reset("DP-2", nil, nil, nil, "10")
	directional.move(state, "right")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.direction, "right", "move direction")
end)

run("hdmi right moves window to ultrawide monitor", function()
	reset("HDMI-A-2")
	directional.move(state, "right")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "DP-2", "target monitor")
	assert_equal(
		order_state.transfer_intent_for_window(active_window).monitor_role,
		monitor_role.ultrawide,
		"transfer role"
	)
	assert_equal(order_state.transfer_intent_for_window(active_window).axis, "x", "transfer axis")
	assert_equal(order_state.transfer_intent_for_window(active_window).edge, "start", "transfer edge")
end)

run("hdmi down uses portrait layout swap", function()
	reset("HDMI-A-2")
	directional.move(state, "down")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapnext", "layout message")
end)

run("hdmi up uses portrait layout swap", function()
	reset("HDMI-A-2")
	directional.move(state, "up")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapprev", "layout message")
end)

run("dp resize left uses ultrawide layout resize", function()
	reset("DP-2")
	directional.adjust(state, "resize", "left")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "resize-left", "layout message")
end)

run("dp resize right uses ultrawide layout resize", function()
	reset("DP-2")
	directional.adjust(state, "resize", "right")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "resize-right", "layout message")
end)

run("dp scrolling workspace uses native resize", function()
	reset("DP-2", nil, nil, nil, "10")
	directional.adjust(state, "resize", "right")()
	assert_equal(dispatched[1].op, "window.resize", "dispatcher")
	assert_equal(dispatched[1].args.x, 32, "resize x")
end)

run("hdmi resize up uses portrait layout resize", function()
	reset("HDMI-A-2")
	directional.adjust(state, "resize", "up")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "resize-up", "layout message")
end)

run("non-special resize uses window resize dispatcher", function()
	reset("DP-1")
	directional.adjust(state, "resize", "right")()
	assert_equal(dispatched[1].op, "window.resize", "dispatcher")
	assert_equal(dispatched[1].args.x, 32, "resize x")
end)
