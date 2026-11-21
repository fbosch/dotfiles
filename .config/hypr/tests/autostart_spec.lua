local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/autostart_spec%.lua$") or ".config/hypr"

describe("session autostart", function()
	it("finalizes UWSM before launching session applications", function()
		local modules = {
			["lib.command"] = {
				line = function(value)
					return value
				end,
			},
			["lib.paths"] = {
				runtime_script = function(value)
					return value
				end,
			},
			["lib.system"] = {
				hostname = function()
					return "test"
				end,
			},
			["benchmarks.startup-recorder"] = {
				armed = function()
					return false
				end,
			},
		}
		local saved = {}
		for name, value in pairs(modules) do
			saved[name] = package.loaded[name]
			package.loaded[name] = value
		end
		local original_hl, original_getenv = _G.hl, os.getenv
		local events, commands = {}, {}
		_G.hl = {
			on = function(name, callback)
				events[name] = callback
			end,
			exec_cmd = function(command)
				commands[#commands + 1] = command
			end,
		}
		os.getenv = function()
			return nil
		end
		local ok, err = pcall(function()
			assert(loadfile(config_dir .. "/autostart.lua"))()
			events["hyprland.start"]()
			assert.are.equal("uwsm finalize", commands[1])
			assert.is_true(#commands > 1)
		end)
		_G.hl, os.getenv = original_hl, original_getenv
		for name in pairs(modules) do
			package.loaded[name] = saved[name]
		end
		assert(ok, err)
	end)
end)
