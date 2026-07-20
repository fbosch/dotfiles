local script_path = arg[0] or ""
local config_dir = script_path:match("^(.*)/tests/bind%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local registrations = {}
local dispatched = {}

hl = {
	dsp = {
		exec_cmd = function(command)
			return { kind = "exec_cmd", command = command }
		end,
	},
	dispatch = function(command)
		table.insert(dispatched, command)
		return { dispatched = true }
	end,
	bind = function(keys, action, options)
		table.insert(registrations, { keys = keys, action = action, options = options })
	end,
}

local bind = require("lib.bind")

local function assert_equal(actual, expected, message)
	if actual ~= expected then
		error(string.format("%s: expected %s, got %s", message, tostring(expected), tostring(actual)), 2)
	end
end

local function assert_nil(actual, message)
	assert_equal(actual, nil, message)
end

local function assert_table(actual, message)
	assert_equal(type(actual), "table", message)
	return actual
end

local function run(name, test)
	registrations = {}
	dispatched = {}
	local ok, err = pcall(test)
	if not ok then
		io.stderr:write("FAIL " .. name .. "\n" .. err .. "\n")
		os.exit(1)
	end

	print("PASS " .. name)
end

run("direct command is converted to exec_cmd at registration", function()
	bind.register("SUPER, X", "notify-send hello")

	local registration = assert_table(registrations[1], "registration")
	assert_equal(registration.keys, "SUPER, X", "keys")
	assert_equal(registration.action.kind, "exec_cmd", "action kind")
	assert_equal(registration.action.command, "notify-send hello", "action command")
	assert_nil(registration.options, "options")
end)

run("direct callback is passed through unchanged", function()
	local action = function(event)
		return { event = event }
	end

	bind.register("SUPER, C", action)

	assert_equal(registrations[1].action, action, "callback identity")
	assert_nil(registrations[1].options, "options")
end)

run("predicate calls true action with the original event", function()
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

	local result = registrations[1].action(event)
	assert_equal(predicate_event, event, "predicate event")
	assert_equal(action_event, event, "action event")
	assert_equal(result, action_result, "action result")
end)

run("false predicate defaults to passing the original event", function()
	local event = { key = "X" }

	bind.register("SUPER, X", function()
		error("true action must not run")
	end, {
		predicate = function(received_event)
			return received_event == event and false
		end,
	})

	local result = registrations[1].action(event)
	assert_equal(result.pass_event, true, "pass event")
end)

run("false predicate calls explicit false callback with the original event", function()
	local event = { key = "X" }
	local false_event
	local false_result = { ok = false, error = "not applicable" }

	bind.register("SUPER, X", function()
		error("true action must not run")
	end, {
		predicate = function()
			return false
		end,
		on_false = function(received_event)
			false_event = received_event
			return false_result
		end,
	})

	assert_equal(registrations[1].action(event), false_result, "false action result")
	assert_equal(false_event, event, "false action event")
end)

run("predicate options are stripped and native options are preserved", function()
	bind.register("SUPER, X", "true-command", {
		predicate = function()
			return true
		end,
		on_false = "false-command",
		release = true,
		locked = false,
	})

	local options = assert_table(registrations[1].options, "native options")
	assert_nil(options.predicate, "predicate option")
	assert_nil(options.on_false, "on_false option")
	assert_equal(options.release, true, "release option")
	assert_equal(options.locked, false, "locked option")

	registrations[1].action({})
	assert_equal(dispatched[1].command, "true-command", "true command")
end)

run("explicit false command is dispatched when predicate is false", function()
	bind.register("SUPER, X", "true-command", {
		predicate = function()
			return false
		end,
		on_false = "false-command",
	})

	registrations[1].action({})
	assert_equal(dispatched[1].command, "false-command", "false command")
end)
