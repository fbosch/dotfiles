-- Lua-native equivalent of scripts/killactive-selective.sh for Lua keybinds.
-- Keep the Bash script for legacy hyprland.conf until Lua config is release-ready.

local ags = require("lib.ags")
local command = require("lib.command")
local minimized = require("runtime.windows.minimized-state")
local notify = require("lib.notify")
local paths = require("lib.paths")
local window = require("lib.window")

local M = {}

local profilectl = paths.runtime_script("profiles/profilectl.sh")

local function is_gaming_active()
	return command.ok(command.line(profilectl, "is-active", "gaming") .. " >/dev/null 2>&1")
end

local function is_gaming_protected_window(app_class)
	return app_class == "gamescope" or app_class:match("^steam_app_.*$") ~= nil
end

local function is_steam_window(app_class)
	return app_class == "Steam" or app_class == "steam"
end

local function confirm_payload(address, title)
	return {
		action = "show",
		config = {
			icon = "!",
			title = "Close game window",
			message = "Close protected game window: " .. (title ~= "" and title or "game window") .. "?",
			confirmLabel = "Close",
			cancelLabel = "Cancel",
			confirmCommand = paths.runtime_script("windows/killactive-selective.sh") .. " --confirmed-address " .. address,
			variant = "warning",
		},
	}
end

local function confirm_close_protected(address, title)
	if not address:match("^0x[%da-fA-F]+$") then
		notify.send({ summary = "Close blocked", body = "Could not confirm protected window without a stable address" })
		return
	end

	ags.request("confirm-dialog", confirm_payload(address, title))
end

function M.close_active_selective()
	local active = window.active()
	local app_class = active and ((active.class ~= "" and active.class) or active.initial_class or "") or ""
	local title = active and (active.title or "") or ""
	local address = active and (active.address or "") or ""

	if is_gaming_active() and is_gaming_protected_window(app_class) then
		confirm_close_protected(address, title)
		return
	end

	if is_steam_window(app_class) then
		minimized.toggle_window()
		return
	end

	hl.dispatch(hl.dsp.window.close())
end

return M
