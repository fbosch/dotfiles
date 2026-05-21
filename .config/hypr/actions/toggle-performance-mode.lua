-- Lua-native equivalent of scripts/toggle-performance-mode.sh for Lua keybinds.
-- Keep the Bash script for legacy hyprland.conf until Lua config is release-ready.

local command = require("lib.command")
local fs = require("lib.fs")
local notify = require("lib.notify")
local paths = require("lib.paths")
local profiles = require("profiles")

local M = {}

local icon_gen = paths.runtime_script("desktop/nerd-icon-gen.sh")
local in_progress = false

local function icon_path(icon, color)
	local path = command.output_line(
		command.line(icon_gen, icon, 64, color) .. " 2>/dev/null"
	)

	if path ~= "" and fs.exists(path) then
		return path
	end

	return nil
end

function M.toggle_performance_mode()
	if in_progress then
		return
	end

	in_progress = true

	if profiles.is_active("performance") then
		profiles.remove("performance")
		notify.send({
			summary = "Performance Mode Disabled",
			icon = icon_path("󰠠", "#dea721"),
			hints = { "string:x-canonical-private-synchronous:perf-mode" },
		})
		in_progress = false
		return
	end

	profiles.activate("performance")
	notify.send({
		summary = "Performance Mode Enabled",
		icon = icon_path("󱤅", "#73bc6f"),
		hints = { "string:x-canonical-private-synchronous:perf-mode" },
	})
	in_progress = false
end

return M
