local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/minimized_workspace_policy_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local function with_environment(environment, callback)
	local original_getenv = os.getenv
	os.getenv = function(name)
		return environment[name]
	end
	package.loaded["runtime.lib.hypr-ipc"] = nil
	package.loaded["runtime.lib.daemon"] = nil
	package.loaded["runtime.windows.minimized-state"] = nil

	local ok, result = pcall(function()
		callback(require("runtime.windows.minimized-state"))
	end)
	os.getenv = original_getenv
	package.loaded["runtime.lib.hypr-ipc"] = nil
	package.loaded["runtime.lib.daemon"] = nil
	package.loaded["runtime.windows.minimized-state"] = nil
	if ok == false then
		error(result, 0)
	end
end

describe("minimized workspace policy", function()
	it("owns the minimized workspace naming decision", function()
		with_environment({
			XDG_RUNTIME_DIR = "/run/user/1000",
			HOME = "/home/fixture",
			HYPRLAND_INSTANCE_SIGNATURE = "instance-a",
		}, function(minimized_state)
			assert.is_true(minimized_state.is_minimized_workspace("special:minimized"))
			assert.is_true(minimized_state.is_minimized_workspace("special:minimized.1"))
			assert.is_false(minimized_state.is_minimized_workspace("special:desktop"))
			assert.is_false(minimized_state.is_minimized_workspace(""))
			assert.is_false(minimized_state.is_minimized_workspace(nil))
		end)
	end)

	it("answers window queries regardless of workspace shape", function()
		with_environment({
			XDG_RUNTIME_DIR = "/run/user/1000",
			HOME = "/home/fixture",
			HYPRLAND_INSTANCE_SIGNATURE = "instance-a",
		}, function(minimized_state)
			assert.is_true(minimized_state.is_minimized_window({ workspace = { name = "special:minimized" } }))
			assert.is_true(minimized_state.is_minimized_window({ workspace = "special:minimized.2" }))
			assert.is_false(minimized_state.is_minimized_window({ workspace = { id = 3 } }))
			assert.is_false(minimized_state.is_minimized_window({}))
		end)
	end)
end)
