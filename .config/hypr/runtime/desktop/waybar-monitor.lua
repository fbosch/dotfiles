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
local worker_interval_ms = 83
local slow_interval_ms = 1000
local process_helper = config_dir .. "/runtime/desktop/waybar-process.sh"
local pip_control_socket = "timeout --foreground 1s nc -w 1 -U "
	.. command.arg(hypr_ipc.instance_socket_path("pip-monitor.sock"))
	.. " >/dev/null 2>&1"
local kit = daemon.new({})
local launch_state_file = kit:instance_path("waybar-launch.pending")
local visibility_state_file = kit:instance_path("waybar-visibility.state")

local pointer_zone = "neutral"
local waybar_mapped = false
local mapped_layer_count = 0
local mapped_layer_ids = {}
local signaled_layer_ids = {}
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
local hide_probe_worker = nil
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

local function copy_layer_ids(ids)
	local copy = {}
	for id in pairs(ids) do
		copy[id] = true
	end
	return copy
end

local function intersect_layer_ids(left, right)
	local intersection = {}
	for id in pairs(left) do
		if right[id] then
			intersection[id] = true
		end
	end
	return intersection
end

local function layer_ids_cover(known, current)
	for id in pairs(current) do
		if not known[id] then
			return false
		end
	end
	return true
end

local function current_waybar_state()
	local mapped = false
	local count = 0
	local identities = {}
	for monitor_name, monitor_layers in pairs(json.object(request("j/layers"))) do
		local surface_index = 0
		for _, level in pairs(monitor_layers.levels or {}) do
			for _, layer in ipairs(level) do
				if layer.namespace == "waybar" then
					mapped = true
					count = count + 1
					surface_index = surface_index + 1
					local surface = layer.address or surface_index
					identities[tostring(monitor_name) .. ":" .. tostring(surface)] = true
				end
			end
		end
	end

	return mapped, count, identities
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

local function publish_state(path, label, visible)
	local ok, err = pcall(kit.write_shared_file, kit, path, visible and "shown\n" or "hidden\n")
	if not ok then
		log("failed to record " .. label .. ": " .. tostring(err))
		return false
	end

	return true
end

local function read_state(path, label)
	local content = kit:read_file(path)
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

	local ok, err = pcall(kit.remove_file, kit, path)
	if not ok then
		log("failed to clear invalid " .. label .. ": " .. tostring(err))
	end
	return nil
end

local function clear_launch_state()
	local ok, err = pcall(kit.remove_file, kit, launch_state_file)
	if not ok then
		log("failed to clear Waybar launch state: " .. tostring(err))
	end
	return ok
end

local function publish_visibility_state(visible)
	return publish_state(visibility_state_file, "Waybar intent", visible)
end

local function read_visibility_state()
	return read_state(visibility_state_file, "Waybar intent")
end

local schedule_pip_visibility
local function record_visibility_intent(visible, requires_launch)
	-- The acknowledgement means this atomic write completed; effects run later.
	if not publish_visibility_state(visible) then
		return false, "error: state-publication-failed"
	end

	if desired_visible ~= visible then
		desired_visible = visible
		intent_generation = intent_generation + 1
		schedule_pip_visibility(visible)
	end
	local should_launch = requires_launch and not waybar_mapped
	if (launch_requested or should_launch) and not publish_state(launch_state_file, "Waybar launch state", visible) then
		return false, "error: state-publication-failed"
	end
	if should_launch then
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
		layer_ids = copy_layer_ids(mapped_layer_ids),
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

local function start_hide_probe_worker()
	local worker, err = workers.start("hide-probe", function()
		return not taskbar_visible() and not swaync_visible()
	end, {
		generation = intent_generation,
	})
	if not worker then
		log(err)
		return false
	end

	hide_probe_worker = worker
	return true
end

schedule_pip_visibility = function(visible)
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
	if waybar_mapped then
		launch_started_at = nil
		launch_requested = false
	else
		launch_started_at = now_ms()
		launch_requested = true
	end
	launch_timeout_reported = false
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
	signaled_layer_ids = intersect_layer_ids(worker.metadata.layer_ids, mapped_layer_ids)
	if worker.metadata.generation ~= intent_generation or worker.metadata.visible ~= desired_visible then
		reconciliation_dirty = true
		return
	end
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
	if worker.metadata.visible ~= pip_desired_visible then
		pip_dirty = true
		reconciliation_dirty = true
		return
	end

	pip_effective_visible = worker.metadata.visible
	pip_dirty = pip_effective_visible ~= pip_desired_visible
end

local function reap_hide_probe_worker()
	if not hide_probe_worker then
		return
	end

	local finished, may_hide = workers.reap(hide_probe_worker)
	if not finished then
		return
	end
	hide_probe_worker = nil

	if may_hide and effective_visible == true and desired_visible and not super_held and pointer_zone == "hide" then
		record_visibility_intent(false, false)
	end
end
local function reap_workers()
	reap_launch_worker()
	reap_visibility_worker()
	reap_pip_worker()
	reap_hide_probe_worker()
end

local function refresh_mapping()
	if not mapping_dirty then
		return
	end

	mapping_dirty = false
	local mapped, count, identities = current_waybar_state()
	count = tonumber(count) or 0
	local was_mapped = waybar_mapped
	waybar_mapped = mapped
	mapped_layer_count = count
	mapped_layer_ids = identities
	if not mapped then
		signaled_layer_ids = {}
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
		signaled_layer_ids = {}
	else
		signaled_layer_ids = intersect_layer_ids(signaled_layer_ids, mapped_layer_ids)
	end
	clear_launch_state()
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
	if effective_visible == desired_visible and layer_ids_cover(signaled_layer_ids, mapped_layer_ids) then
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
		or (waybar_mapped and (effective_visible ~= desired_visible or not layer_ids_cover(
			signaled_layer_ids,
			mapped_layer_ids
		)))
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
	if waybar_mapped or launch_requested or launch_worker then
		return false, "ok"
	end
	if
		not publish_visibility_state(desired_visible)
		or not publish_state(launch_state_file, "Waybar launch state", desired_visible)
	then
		return false, "error: state-publication-failed"
	end

	prewarm_requested = true
	launch_requested = true
	reconciliation_dirty = true
	return false, "ok"
end

local function hold_waybar()
	local should_quit, response = record_visibility_intent(true, true)
	if response == "ok" then
		super_held = true
	end
	return should_quit, response
end

local function release_waybar()
	super_held = false
	return false, "ok"
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

local function remaining_delay(started_at, delay, now)
	return math.max(0, delay - (now - started_at))
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
		local remaining = remaining_delay(show_started_at, show_delay_ms, now)
		if remaining > 0 then
			return remaining
		end

		show_started_at = nil
		if json.object(request("j/activeworkspace")).name ~= gaming.workspace then
			show_waybar()
		end
		return slow_interval_ms
	end

	show_started_at = nil
	if super_held or pointer_zone ~= "hide" then
		hide_started_at = nil
		return slow_interval_ms
	end

	hide_started_at = hide_started_at or now
	local remaining = remaining_delay(hide_started_at, hide_delay_ms, now)
	if remaining > 0 then
		return remaining
	end

	if not hide_probe_worker then
		start_hide_probe_worker()
	end
	hide_started_at = nil
	return slow_interval_ms
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
	stop_worker(hide_probe_worker)
	launch_worker = nil
	visibility_worker = nil
	pip_worker = nil
	hide_probe_worker = nil
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
	local restored_launch = read_state(launch_state_file, "Waybar launch state")
	if restored_launch ~= nil then
		if restored_visibility == nil then
			desired_visible = restored_launch
		end
		launch_requested = true
		prewarm_requested = not desired_visible
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
		-- Child completion has no readable FD; its polling must not quantize pointer deadlines.
		if launch_worker or visibility_worker or pip_worker or hide_probe_worker then
			interval = math.min(interval, worker_interval_ms)
		end
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
