local test_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = test_path:match("^(.*)/tests/native_state_lifecycle_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

describe("native state daemon retirement", function()
	it("does not schedule legacy autostart after native state configuration", function()
		local names = { "plugins.persistent_position", "lib.system", "benchmarks.startup-recorder" }
		local saved = {}
		for _, name in ipairs(names) do
			saved[name] = package.loaded[name]
		end
		local old_hl, old_env, old_path = _G.hl, os.getenv, package.path
		local commands = {}
		package.loaded["plugins.persistent_position"] = { enabled = true, native_state = true }
		package.loaded["lib.system"] = {
			hostname = function()
				return "test-host"
			end,
		}
		package.loaded["benchmarks.startup-recorder"] = {
			armed = function()
				return false
			end,
		}
		os.getenv = function(name)
			if name == "XDG_RUNTIME_DIR" or name == "HYPRLAND_INSTANCE_SIGNATURE" then
				return nil
			end
			return old_env(name)
		end
		_G.hl = {
			on = function(event, callback)
				if event == "hyprland.start" then
					callback()
				end
			end,
			exec_cmd = function(command)
				commands[#commands + 1] = command
			end,
		}
		local ok, err = pcall(assert(loadfile(config_dir .. "/autostart.lua")))
		_G.hl, os.getenv, package.path = old_hl, old_env, old_path
		for _, name in ipairs(names) do
			package.loaded[name] = saved[name]
		end
		assert.is_true(ok, tostring(err))
		assert.is_true(#commands > 0)
		for _, command in ipairs(commands) do
			assert.is_nil(command:find("window-state/window-state.sh", 1, true))
		end
	end)
end)
