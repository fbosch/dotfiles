local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/pip_pointer_adapter_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local dispatched
local adapter

local function target(address, matches)
	return { address = address, pip = matches }
end

before_each(function()
	dispatched = {}
	_G.hl = {
		dsp = {
			exec_cmd = function(command)
				return { kind = "exec", command = command }
			end,
			focus = function()
				return { kind = "focus" }
			end,
			cursor = {
				move = function()
					return { kind = "cursor" }
				end,
			},
		},
		dispatch = function(command)
			dispatched[#dispatched + 1] = command
		end,
		get_active_window = function()
			return nil
		end,
		get_windows = function()
			return {}
		end,
	}

	package.loaded["lib.picture_in_picture"] = {
		matches = function(window)
			return window ~= nil and window.pip == true
		end,
		control = {
			encode = function(action, address)
				return address and action .. " " .. address or action
			end,
		},
	}
	package.loaded["lib.async"] = {
		runtime_lua = function()
			return "warp-active"
		end,
	}
	package.loaded["lib.command"] = {
		arg = function(value)
			return value
		end,
	}
	package.loaded["runtime.lib.hypr-ipc"] = {
		instance_socket_path = function()
			return "/tmp/pip-monitor.sock"
		end,
	}
	package.loaded["actions.picture-in-picture"] = nil
	adapter = require("actions.picture-in-picture")
end)

local function command_contains(expected)
	assert.equal(1, #dispatched)
	assert.equal("exec", dispatched[1].kind)
	assert.is_truthy(dispatched[1].command:find(expected, 1, true))
end

describe("PiP pointer adapter", function()
	it("claims a PiP drag without dispatching native movement", function()
		assert.is_true(adapter.start_drag(target("0x1", true)))
		command_contains("drag-start 0x1")
	end)

	it("cancels drag release when the router cannot revalidate the target", function()
		adapter.finish_drag(nil)
		command_contains("drag-cancel")
	end)

	it("finishes drag for a revalidated PiP target", function()
		adapter.finish_drag(target("0x1", true))
		command_contains("drag-end")
	end)

	it("captures resize identity without dispatching native resize", function()
		assert.is_true(adapter.start_resize(target("0x1", true)))
		command_contains("resize-start 0x1")
	end)

	it("cancels resize release when identity no longer matches PiP", function()
		adapter.finish_resize(target("0x1", false))
		command_contains("resize-cancel")
	end)

	it("finishes resize for a revalidated PiP target", function()
		adapter.finish_resize(target("0x1", true))
		command_contains("resize-end")
	end)
end)
