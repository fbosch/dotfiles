local config_dir = arg[0]:match("^(.*)/tests/window_move%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local dispatched = {}
local active_window = nil

hl = {
	dsp = {
		exec_cmd = function(command)
			return { op = "exec_cmd", command = command }
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

local function reset(monitor)
	dispatched = {}
	active_window = { monitor = { name = monitor }, at = { x = 100, y = 200 }, size = { x = 300, y = 400 } }
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
	assert_equal(dispatched[2].op, "cursor.move", "cursor dispatcher")
	assert_equal(dispatched[2].args.x, 250, "cursor x")
	assert_equal(dispatched[2].args.y, 400, "cursor y")
end)

run("dp left moves only active window to workspace one", function()
	reset("DP-2")
	window.move("left")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.workspace, "1", "target workspace")
	assert_equal(dispatched[2].op, "cursor.move", "cursor dispatcher")
end)

run("hdmi right moves window to ultrawide monitor", function()
	reset("HDMI-A-2")
	window.move("right")()
	assert_equal(dispatched[1].op, "window.move", "dispatcher")
	assert_equal(dispatched[1].args.monitor, "DP-2", "target monitor")
end)

run("hdmi down swaps within portrait monitor", function()
	reset("HDMI-A-2")
	window.move("down")()
	assert_equal(dispatched[1].op, "window.swap", "dispatcher")
	assert_equal(dispatched[1].args.direction, "down", "swap direction")
end)
