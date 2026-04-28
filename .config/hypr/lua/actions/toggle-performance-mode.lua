-- Lua-native equivalent of scripts/toggle-performance-mode.sh for Lua keybinds.
-- Keep the Bash script for legacy hyprland.conf until Lua config is release-ready.

local system = require("lua.lib.system")
local command = require("lua.lib.command")
local fs = require("lua.lib.fs")
local notify = require("lua.lib.notify")
local paths = require("lua.lib.paths")

local M = {}

local profilectl = paths.script("profilectl.sh")
local icon_gen = paths.script("nerd-icon-gen.sh")
local in_progress = false

local function icon_path(icon, color)
	local path = command.output_line(
		system.shell_quote(icon_gen) .. " " .. system.shell_quote(icon) .. " 64 " .. system.shell_quote(color) .. " 2>/dev/null"
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

	if command.ok(system.shell_quote(profilectl) .. " is-active performance >/dev/null 2>&1") then
		command.ok(system.shell_quote(profilectl) .. " remove performance")
		notify.send({
			summary = "Performance Mode Disabled",
			icon = icon_path("󰠠", "#dea721"),
			hints = { "string:x-canonical-private-synchronous:perf-mode" },
		})
		in_progress = false
		return
	end

	command.ok(system.shell_quote(profilectl) .. " apply performance")
	notify.send({
		summary = "Performance Mode Enabled",
		icon = icon_path("󱤅", "#73bc6f"),
		hints = { "string:x-canonical-private-synchronous:perf-mode" },
	})
	in_progress = false
end

return M
