local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/pointer_edge_hooks_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local original_getenv = os.getenv
local original_hl = _G.hl

local loaded_path
local started

local function load_module()
	loaded_path = nil
	started = nil

	os.getenv = function(name)
		if name == "HYPR_POINTER_EDGE_HOOKS_PLUGIN" then
			return "/nix/store/pointer-edge-hooks/lib/libpointer-edge-hooks.so"
		end
		return original_getenv(name)
	end

	_G.hl = {
		plugin = {
			load = function(path)
				loaded_path = path
			end,
			pointer_edge_hooks = {
				start = function(show_threshold, hide_threshold)
					started = { show_threshold, hide_threshold }
				end,
			},
		},
	}

	package.loaded["plugins.pointer_edge_hooks"] = nil
	require("plugins.pointer_edge_hooks")
end

after_each(function()
	os.getenv = original_getenv
	package.loaded["plugins.pointer_edge_hooks"] = nil
	_G.hl = original_hl
end)

describe("Pointer edge hooks config", function()
	it("loads the native Socket2 producer with the existing thresholds", function()
		load_module()
		assert.are.equal("/nix/store/pointer-edge-hooks/lib/libpointer-edge-hooks.so", loaded_path)
		assert.are.same({ 20, 60 }, started)
	end)
end)
