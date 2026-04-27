-- Staged Hyprland Lua entrypoint.
-- Do not rename this file to hyprland.lua until the Lua config is ready to go live.

local loader = dofile(os.getenv("HOME") .. "/.config/hypr/lua/rule-loader.lua")

local stub_counts = {
	config_calls = 0,
	env_vars = 0,
	curves = 0,
	animations = 0,
	gestures = 0,
	devices = 0,
	monitors = 0,
	workspace_rules = 0,
	window_rules = 0,
	layer_rules = 0,
}

local function stub_handle()
	return {
		set_enabled = function() end,
		is_enabled = function()
			return true
		end,
	}
end

-- Hyprland provides `hl`; local Lua validation needs a small shim.
if hl == nil then
	hl = {
		workspace_rule = function()
			stub_counts.workspace_rules = stub_counts.workspace_rules + 1
			return stub_handle()
		end,
		window_rule = function()
			stub_counts.window_rules = stub_counts.window_rules + 1
			return stub_handle()
		end,
		layer_rule = function()
			stub_counts.layer_rules = stub_counts.layer_rules + 1
			return stub_handle()
		end,
		config = function()
			stub_counts.config_calls = stub_counts.config_calls + 1
		end,
		env = function()
			stub_counts.env_vars = stub_counts.env_vars + 1
		end,
		curve = function()
			stub_counts.curves = stub_counts.curves + 1
		end,
		animation = function()
			stub_counts.animations = stub_counts.animations + 1
		end,
		gesture = function()
			stub_counts.gestures = stub_counts.gestures + 1
		end,
		device = function()
			stub_counts.devices = stub_counts.devices + 1
		end,
		monitor = function()
			stub_counts.monitors = stub_counts.monitors + 1
		end,
	}
end

local home = os.getenv("HOME")

dofile(home .. "/.config/hypr/lua/base.lua")
local programs = dofile(home .. "/.config/hypr/lua/programs.lua")
local monitors = dofile(home .. "/.config/hypr/lua/monitors.lua")
dofile(home .. "/.config/hypr/lua/rules/workspace-base.lua")
dofile(home .. "/.config/hypr/lua/animations.lua")

local generated = loader.apply_window_rules({
	home .. "/.config/hypr/lua/rules/generated.lua",
})

local before_static_window_rules = stub_counts.window_rules
dofile(home .. "/.config/hypr/lua/rules/init.lua")
local static_window_rules = stub_counts.window_rules - before_static_window_rules

local window_state = loader.apply_window_rules({
	home .. "/.config/hypr/lua/rules/window-state.lua",
})

dofile(home .. "/.config/hypr/lua/environment.lua")
dofile(home .. "/.config/hypr/lua/appearance.lua")
dofile(home .. "/.config/hypr/lua/rules/layer.lua")
dofile(home .. "/.config/hypr/lua/input.lua")

loader.report_warnings(generated.warnings)
loader.report_warnings(window_state.warnings)
loader.log("loaded monitor profile for host " .. tostring(monitors.host))
loader.log("loaded " .. tostring(programs.terminal) .. " terminal command")
loader.log("loaded " .. tostring(stub_counts.env_vars) .. " environment variables")
loader.log("loaded " .. tostring(stub_counts.config_calls) .. " config blocks")
loader.log("loaded " .. tostring(stub_counts.curves) .. " animation curves")
loader.log("loaded " .. tostring(stub_counts.animations) .. " animations")
loader.log("loaded " .. tostring(stub_counts.gestures) .. " gestures")
loader.log("loaded " .. tostring(stub_counts.devices) .. " device configs")
loader.log("loaded " .. tostring(stub_counts.monitors) .. " monitor rules")
loader.log("applied " .. tostring(generated.applied) .. " generated rules")
loader.log("loaded " .. tostring(stub_counts.workspace_rules) .. " static workspace rules")
loader.log("loaded " .. tostring(static_window_rules) .. " static window rules")
loader.log("loaded " .. tostring(stub_counts.layer_rules) .. " layer rules")
loader.log("applied " .. tostring(window_state.applied) .. " window-state rules")
