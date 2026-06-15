local config_dir = arg[0]:match("^(.*)/tests/window_move%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local dispatched = {}
local active_window = nil

hl = {
	dsp = {
		exec_cmd = function(command)
			return { op = "exec_cmd", command = command }
		end,
		layout = function(value)
			return { op = "layout", value = value }
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
		},
	},
	dispatch = function(dispatcher)
		dispatched[#dispatched + 1] = dispatcher
	end,
	get_active_window = function()
		return active_window
	end,
}

local window = require("lib.window")
local monitor_role = require("lib.monitor_role")
local order_state = require("layouts.order_state")

local function reset(monitor, x, monitor_x, workspace_windows)
	dispatched = {}
	active_window = { address = "0xactive", monitor = { name = monitor, x = monitor_x }, at = { x = x or 100, y = 200 }, size = { x = 300, y = 400 } }
	if workspace_windows then
		local workspace = {}
		function workspace:get_windows()
			return workspace_windows
		end

		active_window.workspace = workspace
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

local function run(name, fn)
	fn()
	print("PASS " .. name)
end

run("dp down moves window to portrait monitor", function()
	reset("DP-2")
	window.move("down")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "HDMI-A-2", "target monitor")
	assert_equal(order_state.transfer_intent_for_window(active_window).monitor_role, monitor_role.portrait, "transfer role")
	assert_equal(order_state.transfer_intent_for_window(active_window).axis, "y", "transfer axis")
	assert_equal(order_state.transfer_intent_for_window(active_window).edge, "end", "transfer edge")
	assert_equal(dispatched[2].op, "cursor.move", "cursor dispatcher")
	assert_equal(dispatched[2].args.x, 250, "cursor x")
	assert_equal(dispatched[2].args.y, 400, "cursor y")
end)

run("dp left edge moves window to portrait monitor", function()
	reset("DP-2", 1446)
	window.move("left")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "HDMI-A-2", "target monitor")
	assert_equal(order_state.transfer_intent_for_window(active_window).monitor_role, monitor_role.portrait, "transfer role")
	assert_equal(order_state.transfer_intent_for_window(active_window).axis, "y", "transfer axis")
	assert_equal(order_state.transfer_intent_for_window(active_window).edge, "end", "transfer edge")
	assert_equal(dispatched[2].op, "cursor.move", "cursor dispatcher")
end)

run("dp left edge uses monitor x when available", function()
	reset("DP-2", 2006, 2000)
	window.move("left")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "HDMI-A-2", "target monitor")
end)

run("dp non-left edge swaps left", function()
	reset("DP-2", 3000)
	window.move("left")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapprev", "layout message")
	assert_equal(dispatched[2].op, "cursor.move", "cursor dispatcher")
end)

run("dp outside monitor edge tolerance swaps left", function()
	reset("DP-2", 2100, 2000)
	window.move("left")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapprev", "layout message")
end)

run("dp only tiled window moves left to portrait", function()
	local only = { visible = true, floating = false }
	reset("DP-2", 2100, 2000, { only })
	active_window.visible = only.visible
	active_window.floating = only.floating
	active_window.workspace = only.workspace
	window.move("left")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "HDMI-A-2", "target monitor")
	assert_equal(order_state.transfer_intent_for_window(active_window).monitor_role, monitor_role.portrait, "transfer role")
end)

run("dp multiple tiled windows still swap left", function()
	local first = { visible = true, floating = false }
	local second = { visible = true, floating = false }
	reset("DP-2", 2100, 2000, { first, second })
	active_window.visible = first.visible
	active_window.floating = first.floating
	active_window.workspace = first.workspace
	window.move("left")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapprev", "layout message")
end)

run("dp right uses ultrawide layout swap", function()
	reset("DP-2")
	window.move("right")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapnext", "layout message")
	assert_equal(dispatched[2].op, "cursor.move", "cursor dispatcher")
end)

run("hdmi right moves window to ultrawide monitor", function()
	reset("HDMI-A-2")
	window.move("right")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "DP-2", "target monitor")
	assert_equal(order_state.transfer_intent_for_window(active_window).monitor_role, monitor_role.ultrawide, "transfer role")
	assert_equal(order_state.transfer_intent_for_window(active_window).axis, "x", "transfer axis")
	assert_equal(order_state.transfer_intent_for_window(active_window).edge, "start", "transfer edge")
end)

run("hdmi down uses portrait layout swap", function()
	reset("HDMI-A-2")
	window.move("down")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapnext", "layout message")
end)

run("hdmi up uses portrait layout swap", function()
	reset("HDMI-A-2")
	window.move("up")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "swapprev", "layout message")
end)

run("dp resize left uses ultrawide layout resize", function()
	reset("DP-2")
	window.adjust("resize", "left")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "resize-left", "layout message")
end)

run("dp resize right uses ultrawide layout resize", function()
	reset("DP-2")
	window.adjust("resize", "right")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "resize-right", "layout message")
end)

run("hdmi resize up uses portrait layout resize", function()
	reset("HDMI-A-2")
	window.adjust("resize", "up")()
	assert_equal(dispatched[1].op, "layout", "dispatcher")
	assert_equal(dispatched[1].value, "resize-up", "layout message")
end)

run("non-special resize uses window resize dispatcher", function()
	reset("DP-1")
	window.adjust("resize", "right")()
	assert_equal(dispatched[1].op, "window.resize", "dispatcher")
	assert_equal(dispatched[1].args.x, 32, "resize x")
end)
