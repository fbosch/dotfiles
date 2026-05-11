-- Hyprland Lua entrypoint.

local config_dir = os.getenv("HOME") .. "/.config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local loader = require("rule-loader")

require("base")
require("programs")
require("monitors")
require("layouts.dp2_master")
require("layouts.portrait_dwindle")
require("rules.workspace-base")
require("keybinds")
require("animations")

local generated = loader.apply_window_rule_phase(config_dir, "generated")

require("rules")

local window_state = loader.apply_window_rule_phase(config_dir, "window_state")

require("environment")
require("appearance")
require("profiles").apply_current()
require("rules.layer")
require("input")
require("autostart")

loader.report_results({ generated, window_state })
