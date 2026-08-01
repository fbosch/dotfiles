local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/bind_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local registrations = {}
local dispatched = {}

_G.hl = {
	dsp = {
		exec_cmd = function(command)
			return { kind = "exec_cmd", command = command }
		end,
	},
	dispatch = function(command)
		dispatched[#dispatched + 1] = command
		return { dispatched = true }
	end,
	bind = function(keys, action, options)
		registrations[#registrations + 1] = { keys = keys, action = action, options = options }
	end,
}

local bind = require("lib.bind")

describe("bind.register", function()
	before_each(function()
		registrations = {}
		dispatched = {}
	end)

	it("converts command actions to exec_cmd dispatchers", function()
		bind.register("SUPER, X", "notify-send hello")

		assert.are.equal("SUPER, X", registrations[1].keys)
		assert.are.equal("exec_cmd", registrations[1].action.kind)
		assert.are.equal("notify-send hello", registrations[1].action.command)
		assert.is_nil(registrations[1].options)
	end)

	it("passes the original event to predicate and true action", function()
		local event = { key = "X" }
		local predicate_event
		local action_event
		local action_result = { ok = true }

		bind.register("SUPER, X", function(received_event)
			action_event = received_event
			return action_result
		end, {
			predicate = function(received_event)
				predicate_event = received_event
				return true
			end,
		})

		assert.are.equal(action_result, registrations[1].action(event))
		assert.are.equal(event, predicate_event)
		assert.are.equal(event, action_event)
	end)

	it("preserves native options while dispatching the false command", function()
		bind.register("SUPER, X", "true-command", {
			predicate = function()
				return false
			end,
			on_false = "false-command",
			release = true,
		})

		registrations[1].action({})
		assert.is_nil(registrations[1].options.predicate)
		assert.is_nil(registrations[1].options.on_false)
		assert.is_true(registrations[1].options.release)
		assert.are.equal("false-command", dispatched[1].command)
	end)
end)
