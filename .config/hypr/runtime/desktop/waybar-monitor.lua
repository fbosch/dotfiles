#!/usr/bin/env luajit

local socket = require("socket")

local config_dir = os.getenv("HOME") .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local ags_ipc = require("runtime.lib.ags-ipc")
local command = require("lib.command")
local daemon = require("runtime.lib.daemon")
local gaming = require("gaming.policies")
local hypr_ipc = require("runtime.lib.hypr-ipc")
local json = require("lib.json")
local pip = require("lib.picture_in_picture")

local show_delay_ms = 200
local hide_delay_ms = 300
local fast_interval_ms = 80
local slow_interval_ms = 1000
local waybar_process_pattern = "(^|/)waybar( |$)"
local pip_control_socket = "nc -U "
	.. command.arg(hypr_ipc.instance_socket_path("pip-monitor.sock"))
	.. " >/dev/null 2>&1"
local kit = daemon.new({})

local pointer_zone = "neutral"
local waybar_visible = false
local super_held = false
local show_started_at = nil
local hide_started_at = nil
local control_socket = nil

local valid_zones = { show = true, neutral = true, hide = true }

local function log(message)
	io.stderr:write("waybar-monitor: ", message, "\n")
end

local function now_ms()
	return math.floor(socket.gettime() * 1000)
end

local function request(message)
	local ok, response = pcall(hypr_ipc.request, message)
	if ok then
		return response or ""
	end

	return ""
end

local function current_waybar_visibility()
	for _, monitor_layers in pairs(json.object(request("j/layers"))) do
		for _, level in pairs(monitor_layers.levels or {}) do
			for _, layer in ipairs(level) do
				if layer.namespace == "waybar" and (tonumber(layer.alpha) or 0) > 0 then
					return true
				end
			end
		end
	end

	return false
end

local function taskbar_visible()
	local component = ags_ipc.request("taskbar-visibility", '{"action":"visible-component"}')
	if component ~= "" and component ~= "none" and not component:match("^error:") then
		return true
	end
	for _, name in ipairs({ "start-menu", "calendar-widget", "audio-mixer-widget" }) do
		if ags_ipc.request(name, '{"action":"is-visible"}') == "true" then
			return true
		end
	end
	return false
end

local function swaync_visible()
	return command
		.output(
			"busctl --user call org.erikreider.swaync.cc /org/erikreider/swaync/cc org.erikreider.swaync.cc GetVisibility 2>/dev/null"
		)
		:match("b true") ~= nil
end

local function show_waybar()
	command.ok("printf '%s\\n' " .. command.arg(pip.control.encode("waybar-show")) .. " | " .. pip_control_socket)
	if command.ok("pkill -SIGUSR1 -f " .. command.arg(waybar_process_pattern) .. " >/dev/null 2>&1") then
		waybar_visible = true
	end
end

local function hide_waybar()
	command.ok("printf '%s\\n' " .. command.arg(pip.control.encode("waybar-hide")) .. " | " .. pip_control_socket)
	if command.ok("pkill -SIGUSR2 -f " .. command.arg(waybar_process_pattern) .. " >/dev/null 2>&1") then
		waybar_visible = false
	end
end

local control_handlers = {
	show = show_waybar,
	hold = function()
		super_held = true
		show_waybar()
	end,
	release = function()
		super_held = false
	end,
	hide = hide_waybar,
	ping = function() end,
	quit = function()
		return true
	end,
}

local function handle_control(message)
	local zone = message:match("^pointer%-zone%s+(%a+)$")
	if valid_zones[zone] then
		pointer_zone = zone
		if zone ~= "show" then
			show_started_at = nil
		end
		if zone ~= "hide" then
			hide_started_at = nil
		end
		return false
	end

	local handler = control_handlers[message]
	return handler ~= nil and handler() == true
end

local function update_visibility()
	local now = now_ms()
	if waybar_visible == false then
		hide_started_at = nil
		if pointer_zone ~= "show" then
			show_started_at = nil
			return slow_interval_ms
		end

		show_started_at = show_started_at or now
		if
			now - show_started_at >= show_delay_ms
			and json.object(request("j/activeworkspace")).name ~= gaming.workspace
		then
			show_waybar()
			show_started_at, hide_started_at = nil, nil
		end
		return fast_interval_ms
	end

	show_started_at = nil
	if super_held or pointer_zone ~= "hide" then
		hide_started_at = nil
		return slow_interval_ms
	end

	hide_started_at = hide_started_at or now
	if now - hide_started_at >= hide_delay_ms then
		if not taskbar_visible() and not swaync_visible() then
			hide_waybar()
		end
		hide_started_at = nil
	end
	return fast_interval_ms
end

local function cleanup_control_socket()
	if control_socket then
		control_socket:close()
		control_socket = nil
	end
end

local function run()
	waybar_visible = current_waybar_visibility()
	command.ok("printf 'waybar-" .. (waybar_visible and "show" or "hide") .. "\\n' | " .. pip_control_socket)

	control_socket = kit:control_socket("waybar-monitor.sock")
	command.ok("hyprctl eval " .. command.arg("hl.plugin.pointer_edge_hooks.sync()") .. " >/dev/null 2>&1")

	while true do
		local interval = update_visibility()
		local ready = socket.select({ control_socket:reader() }, nil, interval / 1000)
		if #ready > 0 then
			local action = control_socket:handle_ready(handle_control)
			if action then
				return action
			end
		end
	end
end

local ok, result = xpcall(run, debug.traceback)
cleanup_control_socket()
if ok == false then
	log(result)
	os.exit(1)
end
if result == "restart" then
	os.exit(daemon.restart_exit_status)
end
