-- Lua-native clipboard bridge for Lua keybinds.
-- Keep the Bash script for legacy hyprland.conf until Lua config is release-ready.

local command = require("lib.command")
local window = require("lib.window")
local gaming = require("rules.gaming")
local async = require("lib.async")

local M = {}
local tool_cache = {}
local clipboard_wrapper = nil
local gamescope_displays = nil

local function read_clipboard_text()
	local clipboard_text = command.output("wl-paste --no-newline --type text/plain 2>/dev/null || true")
	if clipboard_text == "" then
		clipboard_text = command.output("wl-paste --no-newline --type text 2>/dev/null || true")
	end
	return clipboard_text
end

local function have(name)
	if tool_cache[name] == nil then
		tool_cache[name] = command.ok("command -v " .. command.arg(name) .. " >/dev/null 2>&1")
	end

	return tool_cache[name]
end

local function using_wl_clipboard_wrapper()
	if clipboard_wrapper == nil then
		clipboard_wrapper = command.output("xclip -version 2>&1"):lower():find("wl%-clipboard%-x11") ~= nil
	end

	return clipboard_wrapper
end

local function add_displays_from_processes(displays, process_pattern)
	local output = command.output("pgrep -af " .. command.arg(process_pattern) .. " 2>/dev/null || true")
	for line in output:gmatch("[^\n]+") do
		for display in line:gmatch(":%d+") do
			displays[display] = true
		end
	end
end

local function list_gamescope_displays()
	if gamescope_displays then
		return gamescope_displays
	end

	local displays = {}
	add_displays_from_processes(displays, "Xwayland.*-terminate.*-force-xrandr-emulation")

	if next(displays) == nil then
		add_displays_from_processes(displays, "Xwayland")
	end

	local result = {}
	for display in pairs(displays) do
		result[#result + 1] = display
	end
	table.sort(result)
	if #result > 0 then
		gamescope_displays = result
	end
	return result
end

local function first_gamescope_display(displays)
	return displays[1]
end

local function write_xclip(display, selection, text)
	local handle = io.popen(
		"DISPLAY=" .. command.arg(display) .. " xclip -selection " .. command.arg(selection) .. " -in >/dev/null 2>&1",
		"w"
	)
	if not handle then
		return false
	end

	local wrote = pcall(handle.write, handle, text)
	local closed = handle:close()
	return wrote and closed == true
end

local function sync_clipboard_to_gamescope(text)
	local displays = list_gamescope_displays()
	local wrote = true
	for _, display in ipairs(displays) do
		wrote = write_xclip(display, "clipboard", text) and wrote
		wrote = write_xclip(display, "primary", text) and wrote
	end

	if wrote then
		return displays
	end

	gamescope_displays = nil
	displays = list_gamescope_displays()
	for _, display in ipairs(displays) do
		write_xclip(display, "clipboard", text)
		write_xclip(display, "primary", text)
	end

	return displays
end

local function active_is_gamescope()
	local active = window.active()
	return active ~= nil and gaming.is_gamescope_window(active)
end

function M.sync_wayland_to_xwayland_now()
	if
		not gaming.has_gamescope_window()
		or not have("wl-paste")
		or not have("xclip")
		or using_wl_clipboard_wrapper()
	then
		return
	end

	local clipboard_text = read_clipboard_text()
	if clipboard_text == "" then
		return
	end

	sync_clipboard_to_gamescope(clipboard_text)
end

function M.paste_with_xwayland_clipboard_now()
	if not have("wl-paste") then
		return
	end

	local clipboard_text = read_clipboard_text()
	if clipboard_text == "" then
		return
	end

	local displays = sync_clipboard_to_gamescope(clipboard_text)

	local display = first_gamescope_display(displays)
	if display and have("xdotool") then
		command.ok("DISPLAY=" .. command.arg(display) .. " xdotool key --clearmodifiers ctrl+v >/dev/null 2>&1")
		return
	end
end

function M.sync_wayland_to_xwayland()
	async.defer(M.sync_wayland_to_xwayland_now, 50)
end

function M.paste_with_clipboard_bridge()
	if active_is_gamescope() then
		async.defer(M.paste_with_xwayland_clipboard_now, 80)
		return
	end
end

return M
