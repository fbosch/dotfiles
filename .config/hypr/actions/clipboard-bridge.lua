-- Lua-native clipboard bridge for Lua keybinds.
-- Keep the Bash script for legacy hyprland.conf until Lua config is release-ready.

local command = require("lib.command")
local window = require("lib.window")

local M = {}
local config_root = os.getenv("HOME") .. "/.config/hypr"
local tool_cache = {}
local clipboard_wrapper = nil
local gamescope_displays = nil
local scheduled_commands = {}

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
	gamescope_displays = result
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
		return
	end

	handle:write(text)
	handle:close()
end

local function active_is_gamescope()
	local active = window.active()
	if not active then
		return false
	end

	return active.class == "gamescope" or active.initial_class == "gamescope"
end

function M.sync_wayland_to_xwayland_now()
	if not have("wl-paste") or not have("xclip") or using_wl_clipboard_wrapper() then
		return
	end

	local clipboard_text = read_clipboard_text()
	if clipboard_text == "" then
		return
	end

	local displays = list_gamescope_displays()
	for _, display in ipairs(displays) do
		write_xclip(display, "clipboard", clipboard_text)
		write_xclip(display, "primary", clipboard_text)
	end
end

function M.paste_with_xwayland_clipboard_now()
	if not have("wl-paste") then
		return
	end

	local clipboard_text = read_clipboard_text()
	if clipboard_text == "" then
		return
	end

	local displays = list_gamescope_displays()
	for _, display in ipairs(displays) do
		write_xclip(display, "clipboard", clipboard_text)
		write_xclip(display, "primary", clipboard_text)
	end

	local display = first_gamescope_display(displays)
	if display and have("xdotool") then
		command.ok("DISPLAY=" .. command.arg(display) .. " xdotool key --clearmodifiers ctrl+v >/dev/null 2>&1")
		return
	end
end

local function schedule(action, delay)
	local cache_key = action .. "\0" .. delay
	local scheduled_command = scheduled_commands[cache_key]
	if scheduled_command then
		hl.exec_cmd(scheduled_command)
		return
	end

	local lua_code = table.concat({
		"package.path=",
		string.format("%q", config_root .. "/?.lua;" .. config_root .. "/?/init.lua;"),
		"..package.path;require(",
		string.format("%q", "actions.clipboard-bridge"),
		").",
		action,
		"()",
	})

	scheduled_command = "sh -c " .. command.arg("sleep " .. delay .. "; lua -e " .. command.arg(lua_code))
	scheduled_commands[cache_key] = scheduled_command
	hl.exec_cmd(scheduled_command)
end

function M.sync_wayland_to_xwayland()
	schedule("sync_wayland_to_xwayland_now", "0.05")
end

function M.paste_with_clipboard_bridge()
	if active_is_gamescope() then
		schedule("paste_with_xwayland_clipboard_now", "0.08")
		return
	end
end

return M
