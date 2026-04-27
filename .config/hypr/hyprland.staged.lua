-- Staged Hyprland Lua entrypoint.
-- Do not rename this file to hyprland.lua until the Lua config is ready to go live.

local loader = dofile(os.getenv("HOME") .. "/.config/hypr/lua/rule-loader.lua")

local stub_counts = {
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
	}
end

local generated = loader.compile_rules({
	os.getenv("HOME") .. "/.config/hypr/lua/generated-rules.lua",
})

dofile(os.getenv("HOME") .. "/.config/hypr/lua/rules.lua")

local window_state = loader.compile_rules({
	os.getenv("HOME") .. "/.config/hypr/lua/window-state-rules.lua",
})

loader.report_warnings(generated.warnings)
loader.report_warnings(window_state.warnings)
loader.log("compiled " .. tostring(#generated.rules) .. " generated rules")
loader.log("loaded " .. tostring(stub_counts.workspace_rules) .. " static workspace rules")
loader.log("loaded " .. tostring(stub_counts.window_rules) .. " static window rules")
loader.log("compiled " .. tostring(#window_state.rules) .. " window-state rules")
