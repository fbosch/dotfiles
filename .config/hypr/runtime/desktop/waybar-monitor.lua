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
local workers = require("runtime.desktop.waybar-workers")

local show_delay_ms = 200
local hide_delay_ms = 300
local launch_timeout_ms = 10000
local worker_shutdown_wait_ms = 500
local fast_interval_ms = 83
local slow_interval_ms = 1000
local process_helper = config_dir .. "/runtime/desktop/waybar-process.sh"
local pip_control_socket = "timeout --foreground 1s nc -w 1 -U "
	.. command.arg(hypr_ipc.instance_socket_path("pip-monitor.sock"))
	.. " >/dev/null 2>&1"
local kit = daemon.new({})
local visibility_state_file = kit:instance_path("waybar-visibility.state")

local pointer_zone = "neutral"
local waybar_mapped = false
local mapped_layer_count = 0
local signaled_layer_count = 0
local desired_visible = false
local effective_visible = nil
local pip_effective_visible = nil
local pip_desired_visible = false
local pip_dirty = false
local launch_requested = false
local prewarm_requested = false
local launch_started_at = nil
local launch_timeout_reported = false
local intent_generation = 0
local reconciliation_dirty = false
local mapping_dirty = true
local super_held = false
local show_started_at = nil
local hide_started_at = nil
local launch_worker = nil
local visibility_worker = nil
local pip_worker = nil
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
	local count = 0
	for _, monitor_layers in pairs(json.object(request("j/layers"))) do
		for _, level in pairs(monitor_layers.levels or {}) do
			for _, layer in ipairs(level) do
				if layer.namespace == "waybar" then
					mapped = true
					count = count + 1
				end
			end
		end
	end

	return mapped, count
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
			"timeout --foreground 0.5s busctl --user call org.erikreider.swaync.cc /org/erikreider/swaync/cc org.erikreider.swaync.cc GetVisibility 2>/dev/null"
		)
		:match("b true") ~= nil
end

local function process_command(...)
	return command.line(process_helper, ...)
end

local function waybar_process_running()
	return command.ok("timeout --foreground 0.5s " .. process_command("running") .. " >/dev/null 2>&1")
end

local function publish_visibility_state(visible)
	local ok, err = pcall(kit.write_shared_file, kit, visibility_state_file, visible and "shown\n" or "hidden\n")
	if not ok then
		log("failed to record Waybar intent: " .. tostring(err))
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

	local ok, err = pcall(kit.remove_file, kit, visibility_state_file)
	if not ok then
		log("failed to clear invalid Waybar intent: " .. tostring(err))
	end
	return nil
end

local function record_visibility_intent(visible, requires_launch)
	-- The acknowledgement means this atomic write completed; effects run later.
	if not publish_visibility_state(visible) then
		return false, "error: state-publication-failed"
	end

	desired_visible = visible
	intent_generation = intent_generation + 1
	if requires_launch then
		launch_requested = true
	end
	reconciliation_dirty = true
	return false, "ok"
end

local function start_launch_worker()
	local launch = "uwsm-app -s s -t service -u "
		.. command.arg("app-Hyprland-waybar-demand-" .. os.getenv("HYPRLAND_INSTANCE_SIGNATURE") .. ".service")
		.. " -S both -- waybar"
	local worker, err = workers.start("launch", function()
		return command.ok(process_command("replace-unit", launch) .. " >/dev/null 2>&1")
	end, {
		generation = intent_generation,
	})
	if not worker then
		log(err)
		reconciliation_dirty = true
		return false
	end

	launch_worker = worker
	launch_started_at = now_ms()
	launch_timeout_reported = false
	return true
end

local function start_visibility_worker(visible)
	local worker, err = workers.start("visibility", function()
		local signal = visible and "USR1" or "USR2"
		return command.ok("timeout --foreground 0.5s " .. process_command("signal", signal) .. " >/dev/null 2>&1")
	end, {
		generation = intent_generation,
		visible = visible,
		layer_count = mapped_layer_count,
	})
	if not worker then
		log(err)
		reconciliation_dirty = true
		return false
	end

	visibility_worker = worker
	return true
end

local function start_pip_worker(visible)
	local worker, err = workers.start("pip", function()
		local action = pip.control.encode(visible and "waybar-show" or "waybar-hide")
		return command.ok("printf '%s\\n' " .. command.arg(action) .. " | " .. pip_control_socket)
	end, {
		generation = intent_generation,
		visible = visible,
	})
	if not worker then
		log(err)
		reconciliation_dirty = true
		return false
	end

	pip_worker = worker
	return true
end

local function schedule_pip_visibility(visible)
	pip_desired_visible = visible
	pip_dirty = true
	reconciliation_dirty = true
end

local function reap_launch_worker()
	if not launch_worker then
		return
	end

	local finished, succeeded = workers.reap(launch_worker)
	if not finished then
		return
	end

	launch_worker = nil
	if succeeded then
		return
	end

	log("Waybar launch worker failed")
	launch_started_at = nil
	launch_timeout_reported = false
	launch_requested = desired_visible or prewarm_requested
	reconciliation_dirty = true
end

local function reap_visibility_worker()
	if not visibility_worker then
		return
	end

	local worker = visibility_worker
	local finished, succeeded = workers.reap(worker)
	if not finished then
		return
	end

	visibility_worker = nil
	if not succeeded then
		log("Waybar visibility signal failed; keeping confirmed visibility for retry")
		reconciliation_dirty = true
		return
	end

	effective_visible = worker.metadata.visible
	signaled_layer_count = math.min(worker.metadata.layer_count, mapped_layer_count)
	schedule_pip_visibility(effective_visible)
end

local function reap_pip_worker()
	if not pip_worker then
		return
	end

	local worker = pip_worker
	local finished, succeeded = workers.reap(worker)
	if not finished then
		return
	end

	pip_worker = nil
	if not succeeded then
		log("Waybar PiP notification failed; keeping it dirty for retry")
		reconciliation_dirty = true
		return
	end

	pip_effective_visible = worker.metadata.visible
	pip_dirty = pip_effective_visible ~= pip_desired_visible
end

local function reap_workers()
	reap_launch_worker()
	reap_visibility_worker()
	reap_pip_worker()
end

local function refresh_mapping()
	if not mapping_dirty then
		return
	end

	mapping_dirty = false
	local mapped, count = current_waybar_state()
	count = tonumber(count) or 0
	local was_mapped = waybar_mapped
	waybar_mapped = mapped
	mapped_layer_count = count

	if not mapped then
		signaled_layer_count = 0
		if was_mapped or effective_visible == true then
			effective_visible = false
			schedule_pip_visibility(false)
		end
		if desired_visible then
			launch_requested = true
		end
		reconciliation_dirty = true
		return
	end

	if not was_mapped then
		signaled_layer_count = 0
	else
		signaled_layer_count = math.min(signaled_layer_count, count)
	end
	launch_requested = false
	prewarm_requested = false
	launch_started_at = nil
	launch_timeout_reported = false
	reconciliation_dirty = true
end

local function reconcile_launch(now)
	if waybar_mapped or launch_worker then
		return
	end
	if not launch_requested then
		if not desired_visible then
			return
		end
		launch_requested = true
	end

	if launch_started_at then
		if now - launch_started_at < launch_timeout_ms then
			return
		end
		if waybar_process_running() then
			if not launch_timeout_reported then
				log("Waybar process has not mapped within 10 seconds")
				launch_timeout_reported = true
			end
			return
		end

		log("Waybar launch did not produce a mapped layer; retrying")
		launch_started_at = nil
		launch_timeout_reported = false
	end

	if waybar_process_running() then
		launch_started_at = now
		return
	end

	start_launch_worker()
end

local function reconcile_visibility()
	if not waybar_mapped or visibility_worker then
		return
	end
	if effective_visible == desired_visible and signaled_layer_count >= mapped_layer_count then
		return
	end

	start_visibility_worker(desired_visible)
end

local function reconcile_pip()
	if pip_worker or not pip_dirty then
		return
	end
	if pip_effective_visible == pip_desired_visible then
		pip_dirty = false
		return
	end

	start_pip_worker(pip_desired_visible)
end

local function reconcile()
	if not reconciliation_dirty and not mapping_dirty then
		return
	end

	refresh_mapping()
	local now = now_ms()
	reconcile_launch(now)
	reconcile_visibility()
	reconcile_pip()
	reconciliation_dirty = mapping_dirty
		or launch_worker ~= nil
		or visibility_worker ~= nil
		or pip_worker ~= nil
		or (not waybar_mapped and launch_requested)
		or (waybar_mapped and (effective_visible ~= desired_visible or signaled_layer_count < mapped_layer_count))
		or pip_dirty
end

local function handle_layer_event()
	mapping_dirty = true
	reconciliation_dirty = true
	return false, "ok"
end

local function show_waybar()
	return record_visibility_intent(true, true)
end

local function hide_waybar()
	return record_visibility_intent(false, false)
end

local function prewarm_waybar()
	local should_quit, response = record_visibility_intent(false, true)
	if response == "ok" then
		prewarm_requested = true
	end
	return should_quit, response
end

local function hold_waybar()
	local should_quit, response = record_visibility_intent(true, true)
	if response == "ok" then
		super_held = true
	end
	return should_quit, response
end

local function release_waybar()
	local should_quit, response = record_visibility_intent(desired_visible, false)
	if response == "ok" then
		super_held = false
	end
	return should_quit, response
end

local control_handlers = {
	show = show_waybar,
	hide = hide_waybar,
	prewarm = prewarm_waybar,
	hold = hold_waybar,
	release = release_waybar,
	["layer-opened"] = handle_layer_event,
	["layer-closed"] = handle_layer_event,
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

local function update_visibility()
	local now = now_ms()
	if effective_visible ~= true then
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

local function stop_worker(worker)
	if not worker then
		return
	end

	workers.terminate(worker)
	local deadline = now_ms() + worker_shutdown_wait_ms
	while now_ms() < deadline do
		local finished = workers.reap(worker)
		if finished then
			return
		end
		socket.sleep(0.01)
	end

	workers.kill(worker)
	workers.wait(worker)
end

local function cleanup_workers()
	stop_worker(launch_worker)
	stop_worker(visibility_worker)
	stop_worker(pip_worker)
	launch_worker = nil
	visibility_worker = nil
	pip_worker = nil
end

local function cleanup_control_socket()
	if control_socket then
		control_socket:close()
		control_socket = nil
	end
end

local function run()
	local restored_visibility = read_visibility_state()
	if restored_visibility ~= nil then
		desired_visible = restored_visibility
	end

	control_socket = kit:control_socket("waybar-monitor.sock")
	command.ok(
		"timeout --foreground 0.5s hyprctl eval "
			.. command.arg("hl.plugin.pointer_edge_hooks.sync()")
			.. " >/dev/null 2>&1"
	)

	while true do
		reap_workers()
		reconcile()
		local interval = update_visibility()
		reconcile()
		local ready = socket.select({ control_socket:reader() }, nil, interval / 1000)
		if #ready > 0 then
			local action = control_socket:handle_ready(handle_control)
			if action then
				return action
			end
			-- handle_ready sent the response before returning, so public effects start here.
			reconcile()
		end
	end
end

local ok, result = xpcall(run, debug.traceback)
cleanup_workers()
cleanup_control_socket()
if ok == false then
	log(result)
	os.exit(1)
end
if result == "restart" then
	os.exit(daemon.restart_exit_status)
end
