-- Hyprland Lua entrypoint.

local config_dir = os.getenv("HOME") .. "/.config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local loader = require("rule-loader")

require("base")
require("programs")
require("monitors")
require("rules.workspace-base")
require("keybinds")
require("animations")

local generated = loader.apply_window_rules({
	config_dir .. "/rules/generated.lua",
})

require("rules")

local window_state = loader.apply_window_rules({
	config_dir .. "/rules/window-state.lua",
})

require("environment")
require("appearance")
require("rules.layer")
require("input")
require("autostart")

loader.report_warnings(generated.warnings)
loader.report_warnings(window_state.warnings)
