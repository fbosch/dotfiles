local command = require("lib.command")
local fs = require("lib.fs")
local notify = require("lib.notify")
local paths = require("lib.paths")
local profile_state = require("lib.profile_state")

local M = {}

local icon_gen = paths.runtime_script("desktop/nerd-icon-gen.sh")
local profilectl = paths.runtime_script("profiles/profilectl.sh")
local in_progress = false

local function icon_path(icon, color)
	local path = command.output_line(command.line(icon_gen, icon, 64, color) .. " 2>/dev/null")

	if path ~= "" and fs.exists(path) then
		return path
	end

	return nil
end

function M.toggle_powersave_mode()
	if in_progress then
		return
	end

	in_progress = true

	local ok, state = pcall(profile_state.read)
	if ok and state.selection == "powersave" then
		if command.ok(command.line(profilectl, "clear-manual")) == false then
			in_progress = false
			return
		end

		notify.send({
			summary = "Powersave Mode Disabled",
			icon = icon_path("󰠠", "#dea721"),
			hints = { "string:x-canonical-private-synchronous:powersave-mode" },
		})
		in_progress = false
		return
	end

	if command.ok(command.line(profilectl, "set-manual", "powersave")) == false then
		in_progress = false
		return
	end

	notify.send({
		summary = "Powersave Mode Enabled",
		icon = icon_path("󱤅", "#73bc6f"),
		hints = { "string:x-canonical-private-synchronous:powersave-mode" },
	})
	in_progress = false
end

return M
