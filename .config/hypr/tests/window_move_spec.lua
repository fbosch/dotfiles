local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/window_move_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local dispatched = {}
local active_window

_G.hl = {
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
local order_state = require("layouts.shared.order_state")

local function reset(monitor, x, monitor_x, workspace_name)
	dispatched = {}
	active_window = {
		address = "0xactive",
		monitor = { name = monitor, x = monitor_x },
		at = { x = x or 100, y = 200 },
		size = { x = 300, y = 400 },
		workspace = { name = workspace_name or "2" },
	}
end

describe("window movement", function()
	before_each(function()
		reset("DP-2")
	end)

	it("moves from the ultrawide monitor to the portrait monitor", function()
		window.move("down")()

		assert.are.equal("window.move", dispatched[1].op)
		assert.are.equal("HDMI-A-2", dispatched[1].args.monitor)
		assert.are.equal(monitor_role.portrait, order_state.transfer_intent_for_window(active_window).monitor_role)
		assert.are.equal("cursor.move", dispatched[2].op)
	end)

	it("uses the native window dispatcher for scrolling workspaces", function()
		reset("DP-2", nil, nil, "10")
		window.move("right")()

		assert.are.equal("window.move", dispatched[1].op)
		assert.are.equal("right", dispatched[1].args.direction)
	end)

	it("uses layout swapping away from an ultrawide edge", function()
		reset("DP-2", 3000)
		window.move("left")()

		assert.are.equal("layout", dispatched[1].op)
		assert.are.equal("swapprev", dispatched[1].value)
	end)
end)
