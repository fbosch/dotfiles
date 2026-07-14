#!/usr/bin/env lua

local home = os.getenv("HOME")
local config_dir = home .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local command = require("lib.command")
local gaming = require("rules.gaming")
local hypr_ipc = require("runtime.lib.hypr-ipc")
local json = require("lib.json")

local profilectl = config_dir .. "/runtime/profiles/profilectl.sh"
local ags_start_script = home .. "/.config/ags/start-daemons.sh"

local function notify(summary, body)
	command.ok(command.line("notify-send", "-a", "Hyprland", summary, body) .. " >/dev/null 2>&1")
end

local function valid_address(address)
	return type(address) == "string" and address:match("^0x[%da-fA-F]+$") ~= nil
end

local function close_window(address)
	if valid_address(address) then
		hypr_ipc.request("dispatch closewindow address:" .. address)
		return
	end

	hypr_ipc.request("dispatch closewindow")
end

local function gaming_is_active()
	return command.ok(command.line(profilectl, "is-active", "gaming") .. " >/dev/null 2>&1")
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
			confirmCommand = "lua " .. config_dir .. "/runtime/windows/killactive-selective.lua --confirmed-address " .. address,
			variant = "warning",
		},
	}
end

local function show_confirm_dialog(payload)
	return command.output(
		command.line("ags", "request", "-i", "ags-bundled", "confirm-dialog", json.encode(payload)) .. " 2>/dev/null"
	):gsub("%s+$", "") == "shown"
end

local function request_confirm_close(address, title)
	if valid_address(address) == false then
		notify("Close blocked", "Could not confirm protected window without a stable address")
		return
	end

	local payload = confirm_payload(address, title)
	if show_confirm_dialog(payload) then
		return
	end

	command.ok(command.line(ags_start_script) .. " >/dev/null 2>&1")
	if show_confirm_dialog(payload) == false then
		notify("Close blocked", "Could not show confirmation dialog for: " .. title)
	end
end

if arg[1] == "--confirmed-address" then
	if valid_address(arg[2]) then
		close_window(arg[2])
	else
		notify("Close failed", "Invalid window address")
	end
	return
end

local active_window = json.object(hypr_ipc.request("j/activewindow"))
local address = active_window.address or ""
local title = active_window.title or ""
local policy_window = {
	class = active_window.class,
	initial_class = active_window.initialClass,
	title = title,
	initial_title = active_window.initialTitle,
}

if gaming_is_active() and gaming.requires_close_confirmation(policy_window) then
	request_confirm_close(address, title)
	return
end

close_window(address)
