local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/pointer_edge_hooks_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local original_getenv = os.getenv
local original_command = package.loaded["lib.command"]
local original_hypr_ipc = package.loaded["runtime.lib.hypr-ipc"]
local original_hl = _G.hl

local loaded_path
local rebound
local started
local zone_handler
local dispatched

local function load_module()
	loaded_path = nil
	rebound = 0
	started = nil
	zone_handler = nil
	dispatched = {}

	os.getenv = function(name)
		if name == "HYPR_POINTER_EDGE_HOOKS_PLUGIN" then
			return "/nix/store/pointer-edge-hooks/lib/libpointer-edge-hooks.so"
		end
		return original_getenv(name)
	end

	package.loaded["lib.command"] = {
		arg = function(value)
			return "'" .. value .. "'"
		end,
	}
	package.loaded["runtime.lib.hypr-ipc"] = {
		instance_socket_path = function(name)
			return "/run/user/1000/hypr/test/" .. name
		end,
	}

	_G.hl = {
		plugin = {
			load = function(path)
				loaded_path = path
			end,
			pointer_edge_hooks = {
				rebind = function()
					rebound = rebound + 1
				end,
				start = function(show_threshold, hide_threshold)
					started = { show_threshold, hide_threshold }
				end,
			},
		},
		dsp = {
			exec_cmd = function(value)
				return { op = "exec", value = value }
			end,
		},
		dispatch = function(value)
			dispatched[#dispatched + 1] = value
		end,
		on = function(name, callback)
			assert.are.equal("pointer_edge_hooks.zone", name)
			zone_handler = callback
			return { name = name }
		end,
	}

	package.loaded["plugins.pointer_edge_hooks"] = nil
	require("plugins.pointer_edge_hooks")
end

after_each(function()
	os.getenv = original_getenv
	package.loaded["plugins.pointer_edge_hooks"] = nil
	package.loaded["lib.command"] = original_command
	package.loaded["runtime.lib.hypr-ipc"] = original_hypr_ipc
	_G.hl = original_hl
end)

describe("Pointer edge hooks Waybar adapter", function()
	it("loads the plugin and forwards native zone transitions", function()
		load_module()

		assert.are.equal("/nix/store/pointer-edge-hooks/lib/libpointer-edge-hooks.so", loaded_path)
		assert.are.equal(1, rebound)
		assert.are.same({ 20, 60 }, started)

		zone_handler("show", "DP-2")
		assert.are.equal(1, #dispatched)
		assert.are.equal("exec", dispatched[1].op)
		assert.matches("pointer%-zone show", dispatched[1].value)
		assert.matches("waybar%-monitor%.sock", dispatched[1].value)

		zone_handler("invalid", "DP-2")
		assert.are.equal(1, #dispatched)
	end)
end)
