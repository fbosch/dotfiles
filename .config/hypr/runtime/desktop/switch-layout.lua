#!/usr/bin/env lua

local socket = require("socket")

local home = os.getenv("HOME")
local config_dir = home .. "/.config/hypr"
local json = dofile(config_dir .. "/lib/json.lua")
local hypr_ipc = dofile(config_dir .. "/runtime/lib/hypr-ipc.lua")
local ags_ipc = dofile(config_dir .. "/runtime/lib/ags-ipc.lua")

local log_file = "/tmp/hyprland-layout.log"
local layout_display_codes = {
	us = "ENG",
	dk = "DAN",
}

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function log(message)
	local handle = io.open(log_file, "a")
	if not handle then
		return
	end

	handle:write(message, "\n")
	handle:close()
end

local function command_output(command)
	local handle = io.popen(command)
	if not handle then
		return ""
	end

	local output = handle:read("*a") or ""
	handle:close()
	return output
end

local function command_ok(command)
	local ok, _, code = os.execute(command .. " >/dev/null 2>&1")
	return ok == true or ok == 0 or code == 0
end

local function executable(path)
	return path ~= "" and command_ok("test -x " .. shell_quote(path))
end

local function command_path(name)
	local path = command_output("command -v " .. shell_quote(name) .. " 2>/dev/null"):match("^[^\n]+") or ""
	if path ~= "" then
		return path
	end

	return ""
end

local function setxkbmap_path()
	local candidates = {
		command_path("setxkbmap"),
		"/run/current-system/sw/bin/setxkbmap",
		home .. "/.nix-profile/bin/setxkbmap",
		"/etc/profiles/per-user/" .. (os.getenv("USER") or "") .. "/bin/setxkbmap",
	}

	for _, candidate in ipairs(candidates) do
		if executable(candidate) then
			return candidate
		end
	end

	return ""
end

local function xwayland_displays()
	local displays = {}
	local seen = {}
	for line in command_output("pgrep -af 'Xwayland' 2>/dev/null"):gmatch("[^\n]+") do
		for display in line:gmatch(":%d+") do
			if not seen[display] then
				seen[display] = true
				displays[#displays + 1] = display
			end
		end
	end
	return displays
end

local function sync_gamescope_xwayland_layout(target_layout)
	local setxkbmap = setxkbmap_path()
	if setxkbmap == "" then
		log("setxkbmap not found; skipping Gamescope Xwayland layout sync")
		return
	end

	for _, display in ipairs(xwayland_displays()) do
		command_ok("DISPLAY=" .. shell_quote(display) .. " " .. shell_quote(setxkbmap) .. " -layout " .. shell_quote(target_layout) .. " -option ''")
	end
end

local function decode_json(content, fallback)
	local ok, decoded = pcall(json.decode, content or "")
	if ok and type(decoded) == "table" then
		return decoded
	end

	return fallback
end

local function main_keyboard()
	local devices = decode_json(hypr_ipc.request("j/devices"), {})
	for _, keyboard in ipairs(devices.keyboards or {}) do
		if keyboard.main == true then
			return keyboard
		end
	end

	return nil
end

local function split_layouts(layouts)
	local result = {}
	for layout in tostring(layouts or ""):gmatch("[^,]+") do
		result[#result + 1] = layout
	end
	return result
end

local function display_code(layout)
	return layout_display_codes[layout] or layout
end

local function show_keyboard_switcher(layouts, active_code)
	local display_layouts = {}
	for _, layout in ipairs(layouts) do
		display_layouts[#display_layouts + 1] = display_code(layout)
	end

	ags_ipc.request("keyboard-switcher", json.encode({
		action = "show",
		config = {
			layouts = display_layouts,
			activeLayout = active_code,
			size = "sm",
		},
	}))
end

local function run()
	local before = main_keyboard()
	if not before or not before.name then
		log("Keyboard layout switch skipped: main keyboard not found")
		os.exit(1)
	end

	local layouts = split_layouts(before.layout)
	command_ok("hyprctl switchxkblayout " .. shell_quote(before.name) .. " next")
	socket.sleep(0.1)

	local after = main_keyboard() or before
	local active_layout = layouts[(tonumber(after.active_layout_index) or 0) + 1] or ""
	local active_code = display_code(active_layout)

	sync_gamescope_xwayland_layout(active_layout)
	show_keyboard_switcher(layouts, active_code)
	log("Keyboard layout switched from "
		.. tostring(before.active_keymap or "")
		.. " to "
		.. tostring(after.active_keymap or "")
		.. " (layout: "
		.. active_layout
		.. ", code: "
		.. active_code
		.. ")")
end

run()
