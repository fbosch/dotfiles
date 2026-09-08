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
local launch_timeout_ms = 10000
local fast_interval_ms = 83
local slow_interval_ms = 1000
local process_helper = config_dir .. "/runtime/desktop/waybar-process.sh"
local waybar_unit = "app-Hyprland-waybar-demand-" .. os.getenv("HYPRLAND_INSTANCE_SIGNATURE") .. ".service"
local pip_control_socket = "timeout --foreground 1s nc -w 1 -U "
	.. command.arg(hypr_ipc.instance_socket_path("pip-monitor.sock"))
	.. " >/dev/null 2>&1"
local kit = daemon.new({})
local launch_state_file = kit:instance_path("waybar-launch.pending")
local visibility_state_file = kit:instance_path("waybar-visibility.state")

local pointer_zone = "neutral"
local waybar_mapped = false
local desired_visible = false
local effective_visible = false
local launch_requested_at = nil
local launch_timeout_reported = false
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

local function current_waybar_state()
	local mapped = false
	local visible = false
	for _, monitor_layers in pairs(json.object(request("j/layers"))) do
		for _, level in pairs(monitor_layers.levels or {}) do
			for _, layer in ipairs(level) do
				if layer.namespace == "waybar" then
					mapped = true
					visible = visible or (tonumber(layer.alpha) or 0) > 0
				end
			end
		end
	end

	return mapped, visible
end

local function taskbar_visible()
	local component = ags_ipc.request("taskbar-visibility", '{"action":"visible-component"}')
	if component == "none" then
		return false
	end
	if component ~= "" and not component:match("^error:") then
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

local function notify_pip(visible)
	local action = pip.control.encode(visible and "waybar-show" or "waybar-hide")
	return command.ok("printf '%s\\n' " .. command.arg(action) .. " | " .. pip_control_socket)
end

local function process_command(...)
	return command.line(process_helper, ...)
end

local function signal_waybar(signal)
	return command.ok(process_command("signal", signal) .. " >/dev/null 2>&1")
end

local function waybar_process_running()
	return command.ok(process_command("running") .. " >/dev/null 2>&1")
end

local function stop_waybar_unit()
	return command.ok("timeout --foreground 2s " .. process_command("stop-unit") .. " >/dev/null 2>&1")
end

local function clear_state_file(path, label)
	local ok, err = pcall(kit.remove_file, kit, path)
	if not ok then
		log("failed to clear " .. label .. ": " .. tostring(err))
		return false
	end
	return true
end

local function clear_launch_state()
	return clear_state_file(launch_state_file, "pending launch state")
end

local function clear_visibility_state()
	return clear_state_file(visibility_state_file, "visibility state")
end

local function publish_launch_state(visible)
	local content = string.format("%d\t%s\n", launch_requested_at, visible and "show" or "hide")
	local ok, err = pcall(kit.write_shared_file, kit, launch_state_file, content)
	if not ok then
		log("failed to publish pending launch state: " .. tostring(err))
		return false
	end
	return true
end

local function publish_visibility_state(visible)
	local ok, err = pcall(kit.write_shared_file, kit, visibility_state_file, visible and "shown\n" or "hidden\n")
	if not ok then
		log("failed to publish visibility state: " .. tostring(err))
		return false
	end
	return true
end

local function read_visibility_state()
	local content = kit:read_file(visibility_state_file)
	if not content then
		return nil
	end
	local state = content:match("^(%a+)%s*$")
	if state == "shown" then
		return true
	end
	if state == "hidden" then
		return false
	end
	clear_visibility_state()
	return nil
end

local function restore_launch_state()
	local content = kit:read_file(launch_state_file)
	if not content then
		return
	end

	local timestamp, intent = content:match("^(%d+)%s+(%a+)%s*$")
	timestamp = tonumber(timestamp)
	if not timestamp or (intent ~= "show" and intent ~= "hide") then
		clear_launch_state()
		return
	end

	desired_visible = intent == "show"
	effective_visible = desired_visible
	local age = now_ms() - timestamp
	if age >= 0 and age <= launch_timeout_ms then
		launch_requested_at = timestamp
		launch_timeout_reported = false
		return
	end

	if waybar_process_running() then
		launch_requested_at = now_ms()
		launch_timeout_reported = true
		publish_launch_state(desired_visible)
	else
		clear_launch_state()
	end
end

local function finish_launch_state()
	if not clear_launch_state() then
		return false
	end
	launch_requested_at = nil
	launch_timeout_reported = false
	return true
end

local function abandon_launch(message)
	if clear_launch_state() then
		launch_requested_at = nil
		launch_timeout_reported = false
	end
	waybar_mapped = false
	desired_visible = false
	effective_visible = false
	clear_visibility_state()
	notify_pip(false)
	log(message)
end

local function begin_launch(visible)
	launch_requested_at = now_ms()
	launch_timeout_reported = false
	desired_visible = visible
	effective_visible = visible
	if not publish_launch_state(visible) then
		abandon_launch("Waybar launch was not attempted because ownership state could not be recorded")
		return false
	end

	if waybar_process_running() then
		return true
	end
	if not stop_waybar_unit() then
		abandon_launch("failed to clear the previous Waybar unit")
		return false
	end

	local launch = "timeout --foreground 5s uwsm-app -s s -t service -u "
		.. command.arg(waybar_unit)
		.. " -S both -- waybar >/dev/null 2>&1"
	if not command.ok(launch) then
		log("Waybar launch request did not complete; ownership retained")
		return false
	end
	return true
end

local function prewarm_waybar()
	if waybar_mapped or launch_requested_at or waybar_process_running() then
		return false, "ok"
	end
	if not begin_launch(false) then
		return false, "error: launch-failed"
	end
	return false, "ok"
end

local function complete_mapped_launch(observed_visible)
	waybar_mapped = true
	local visible = desired_visible
	local signal = visible and "USR1" or "USR2"

	-- The initial map is hidden; reveal only when visibility was requested.
	if not signal_waybar(signal) then
		effective_visible = observed_visible
		notify_pip(observed_visible)
		return false, "error: signal-failed"
	end

	effective_visible = visible
	if not publish_visibility_state(visible) or not finish_launch_state() then
		return false, "error: state-publication-failed"
	end
	notify_pip(visible)
	return false, "ok"
end

local function reconcile_mapped_waybar(observed_visible)
	waybar_mapped = true
	local intent = read_visibility_state()
	if intent == nil then
		intent = observed_visible
		publish_visibility_state(intent)
	end
	desired_visible = intent
	-- Waybar emits one layer-opened event per output; avoid restarting a global reveal.
	if observed_visible ~= intent then
		if not signal_waybar(intent and "USR1" or "USR2") then
			effective_visible = observed_visible
			notify_pip(observed_visible)
			return false, "error: signal-failed"
		end
	end
	effective_visible = intent
	notify_pip(intent)
	return false, "ok"
end

local function show_waybar()
	desired_visible = true
	notify_pip(true)

	if launch_requested_at then
		if launch_timeout_reported and not waybar_process_running() then
			if not finish_launch_state() then
				return false, "error: state-publication-failed"
			end
			waybar_mapped = false
		elseif waybar_mapped then
			return complete_mapped_launch(effective_visible)
		else
			effective_visible = true
			if not publish_launch_state(true) then
				return false, "error: state-publication-failed"
			end
			return false, "ok"
		end
	end

	if waybar_mapped then
		if not publish_visibility_state(true) then
			return false, "error: state-publication-failed"
		end
		if signal_waybar("USR1") then
			effective_visible = true
			return false, "ok"
		end

		local mapped = current_waybar_state()
		waybar_mapped = mapped
		if mapped then
			notify_pip(effective_visible)
			log("failed to show mapped Waybar")
			return false, "error: signal-failed"
		end
		clear_visibility_state()
	end

	effective_visible = true
	if not begin_launch(true) then
		return false, "error: launch-failed"
	end
	return false, "ok"
end

local function hide_waybar()
	desired_visible = false
	notify_pip(false)

	if launch_requested_at then
		if launch_timeout_reported and not waybar_process_running() then
			abandon_launch("Waybar exited before mapping")
			return false, "ok"
		end
		effective_visible = false
		if not publish_launch_state(false) then
			return false, "error: state-publication-failed"
		end
		if waybar_mapped then
			return complete_mapped_launch(true)
		end
		return false, "ok"
	end
	if not waybar_mapped then
		effective_visible = false
		clear_visibility_state()
		return false, "ok"
	end

	if not publish_visibility_state(false) then
		return false, "error: state-publication-failed"
	end
	if signal_waybar("USR2") then
		effective_visible = false
		return false, "ok"
	end

	local mapped = current_waybar_state()
	waybar_mapped = mapped
	if not mapped then
		effective_visible = false
		clear_visibility_state()
		return false, "ok"
	end
	notify_pip(effective_visible)
	log("failed to hide mapped Waybar")
	return false, "error: signal-failed"
end

local function handle_layer_opened()
	local mapped, observed_visible = current_waybar_state()
	if not mapped then
		return false, "ok"
	end
	if launch_requested_at then
		return complete_mapped_launch(observed_visible)
	end
	return reconcile_mapped_waybar(observed_visible)
end

local function handle_layer_closed()
	local mapped = current_waybar_state()
	waybar_mapped = mapped
	if mapped or launch_requested_at then
		return false, "ok"
	end
	if effective_visible then
		notify_pip(false)
	end
	desired_visible = false
	effective_visible = false
	clear_visibility_state()
	return false, "ok"
end

local control_handlers = {
	show = show_waybar,
	prewarm = prewarm_waybar,
	hold = function()
		super_held = true
		local should_quit, response = show_waybar()
		if response ~= "ok" then
			super_held = false
		end
		return should_quit, response
	end,
	release = function()
		super_held = false
		return false, "ok"
	end,
	hide = hide_waybar,
	["layer-opened"] = handle_layer_opened,
	["layer-closed"] = handle_layer_closed,
	ping = function()
		return false, "ok"
	end,
	quit = function()
		return true, "ok"
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
		return false, "ok"
	end

	local handler = control_handlers[message]
	if not handler then
		return false, "error: invalid-command"
	end
	return handler()
end

local function reconcile_launch_timeout(now)
	if not launch_requested_at or now - launch_requested_at < launch_timeout_ms or launch_timeout_reported then
		return
	end

	local mapped, observed_visible = current_waybar_state()
	waybar_mapped = mapped
	if mapped then
		local _, response = complete_mapped_launch(observed_visible)
		if response ~= "ok" then
			launch_timeout_reported = true
		end
		return
	end

	if waybar_process_running() then
		launch_timeout_reported = true
		log("Waybar process has not mapped within 10 seconds")
		return
	end

	abandon_launch("Waybar launch failed before mapping")
end

local function update_visibility()
	local now = now_ms()
	reconcile_launch_timeout(now)
	if effective_visible == false then
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
	local mapped, observed_visible = current_waybar_state()
	waybar_mapped = mapped
	restore_launch_state()
	if waybar_mapped then
		if launch_requested_at then
			complete_mapped_launch(observed_visible)
		else
			reconcile_mapped_waybar(observed_visible)
		end
	elseif not launch_requested_at then
		clear_visibility_state()
	end
	notify_pip(effective_visible)

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
