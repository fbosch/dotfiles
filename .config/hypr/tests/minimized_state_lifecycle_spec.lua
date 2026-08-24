local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/minimized_state_lifecycle_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local function with_hyprland(callback)
	local original_getenv = os.getenv
	local original_hl = _G.hl
	local callbacks = {}
	local commands = {}
	local registrations = 0

	os.getenv = function(name)
		local environment = {
			HOME = "/home/fixture",
			XDG_RUNTIME_DIR = "/run/user/1000",
			HYPRLAND_INSTANCE_SIGNATURE = "instance-a",
		}
		return environment[name]
	end
	_G.hl = {
		on = function(name, handler)
			registrations = registrations + 1
			callbacks[name] = handler
			return { name = name }
		end,
		exec_cmd = function(command)
			commands[#commands + 1] = command
		end,
	}

	package.loaded["runtime.lib.hypr-ipc"] = nil
	package.loaded["runtime.lib.daemon"] = nil
	package.loaded["runtime.windows.minimized-state"] = nil

	local ok, result = pcall(function()
		callback(require("runtime.windows.minimized-state"), callbacks, commands, function()
			return registrations
		end)
	end)

	os.getenv = original_getenv
	_G.hl = original_hl
	package.loaded["runtime.lib.hypr-ipc"] = nil
	package.loaded["runtime.lib.daemon"] = nil
	package.loaded["runtime.windows.minimized-state"] = nil
	if not ok then
		error(result, 0)
	end
end

describe("minimized state lifecycle", function()
	it("uses native window events and the locked state worker", function()
		with_hyprland(function(minimized_state, callbacks, commands, registrations)
			assert.is_true(minimized_state.register_lifecycle())
			assert.are.equal(3, registrations())
			assert.is_function(callbacks["window.close"])
			assert.is_function(callbacks["hyprland.start"])
			assert.is_function(callbacks["config.reloaded"])

			callbacks["window.close"]({ address = "0xabc" })
			assert.are.equal(
				"'/home/fixture/.config/hypr/runtime/windows/minimized-state.lua' 'delete' '0xabc'",
				commands[1]
			)

			callbacks["window.close"](nil)
			assert.are.equal(1, #commands)

			callbacks["hyprland.start"]()
			callbacks["config.reloaded"]()
			assert.are.equal("'/home/fixture/.config/hypr/runtime/windows/minimized-state.lua' 'prune'", commands[2])
			assert.are.equal("'/home/fixture/.config/hypr/runtime/windows/minimized-state.lua' 'prune'", commands[3])

			assert.is_true(minimized_state.register_lifecycle())
			assert.are.equal(3, registrations())
		end)
	end)
end)
