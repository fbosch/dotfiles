#!/usr/bin/env luajit

local socket = require("socket")
local ffi = require("ffi")

local config_dir = os.getenv("HOME") .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local json = require("lib.json")
local command = require("lib.command")
local daemon = require("runtime.lib.daemon")

ffi.cdef([[
  typedef int pid_t;
  pid_t fork(void);
  int setpgid(pid_t pid, pid_t pgid);
  int kill(pid_t pid, int sig);
  pid_t waitpid(pid_t pid, int *status, int options);
  pid_t getpid(void);
]])

local mode = arg[1] or "daemon"
local screenshot_dir = os.getenv("HYPR_WINDOW_CAPTURE_DIR")
if not screenshot_dir then
	screenshot_dir = "/tmp/hypr-window-captures"
	if os.execute("test -d /dev/shm >/dev/null 2>&1") then
		screenshot_dir = "/dev/shm/hypr-window-captures"
	end
end

local kit = daemon.new({})
local daemon_lock_dir = kit:instance_path("window-capture-daemon.lock.d")
local worker_lock_dir = kit:instance_path("window-capture-worker.lock.d")
-- Lock exclusivity relies on plain mkdir failing when the lock dir exists, so
-- only the parent chain may be created with -p.
local instance_runtime_dir = daemon_lock_dir:match("^(.*)/")
command.ok("mkdir -p " .. command.arg(instance_runtime_dir) .. " >/dev/null 2>&1")
local last_screenshot_file = screenshot_dir .. "/.last_screenshot"
local last_event_file = screenshot_dir .. "/.last_event"
local capture_lock_file = screenshot_dir .. "/.capture_lock"
local workspace_change_file = screenshot_dir .. "/.workspace_change"
local pending_event_file = screenshot_dir .. "/.pending_event"
local last_healthcheck_file = screenshot_dir .. "/.last_healthcheck"

local debounce_ms = 100
local capture_delay_ms = 50
local window_settle_delay_ms = 150
local workspace_delay_ms = 100
local lock_stale_ms = 10000
local worker_lock_initialization_grace_ms = 100
local healthcheck_interval_ms = 5000
local event_reconnect_delay_s = 0.5
local event_read_timeout_s = 0.5
local worker_shutdown_wait_ms = 500
local temp_file_max_age_s = 30
local grim_timeout_s = 2
local max_parallel_captures = 4
local black_frame_mean_threshold = 10
local jpeg_quality = 75
local preview_target_height = 180
local preview_target_max_width = 320
local command_cache = {}
local capture_window_preview
local worker_pid = nil
local worker_token = nil
local write_sequence = 0

local sigterm = 15
local sigkill = 9
local wnohang = 1

local function log(message)
	io.stderr:write("window-capture: ", message, "\n")
end

local function command_exists(name)
	if command_cache[name] ~= nil then
		return command_cache[name]
	end

	command_cache[name] = command.ok("command -v " .. command.arg(name) .. " >/dev/null 2>&1")
	return command_cache[name]
end

local function process_is_running(pid)
	return pid ~= "" and command.ok("kill -0 " .. command.arg(pid) .. " 2>/dev/null")
end

local function run_with_timeout(timeout_s, command_line)
	if command_exists("timeout") then
		return command.ok("timeout --kill-after=1 " .. command.arg(tostring(timeout_s) .. "s") .. " " .. command_line)
	end

	return command.ok(command_line)
end

local function now_ms()
	return math.floor(socket.gettime() * 1000)
end

local function read_number(path)
	return tonumber(kit:read_file(path) or "")
end

local function write_file(path, content)
	kit:write_shared_file(path, content)
end

local function remove_file(path)
	os.remove(path)
end

local function file_is_nonempty(path)
	local handle = io.open(path, "r")
	if not handle then
		return false
	end

	local size = handle:seek("end") or 0
	handle:close()
	return size > 0
end

local function mkdir(path)
	command.ok("mkdir -p " .. command.arg(path) .. " >/dev/null 2>&1")
end

local function query(request_message)
	return kit:query(request_message)
end

local function preview_id_for_window(window)
	local stable_id = window and window.stableId or ""
	if stable_id and stable_id ~= "" then
		return stable_id
	end

	return tostring((window and window.address) or ""):gsub("^0x", "")
end

local function window_preview_fields(window)
	if type(window) ~= "table" then
		return "", false, 0, 0
	end

	local width = tonumber(window.size and window.size[1]) or 0
	local height = tonumber(window.size and window.size[2]) or 0
	return preview_id_for_window(window), window.mapped ~= false, width, height
end

local function capture_preview_for_window(window)
	local preview_id, mapped, width, height = window_preview_fields(window)
	if mapped == false or preview_id == "" then
		return
	end

	capture_window_preview(preview_id, width, height)
end

local function cleanup_stale_temp_files()
	command.ok(
		"find "
			.. command.arg(screenshot_dir)
			.. " -maxdepth 1 -name '.temp_*.jpg' -type f -mmin +"
			.. tostring(math.max(1, math.floor(temp_file_max_age_s / 60)))
			.. " -delete 2>/dev/null"
	)
end

local function cleanup_stale_preview_files()
	local all_clients_json = query("j/clients")
	if all_clients_json == "" then
		return
	end

	local live_preview_ids = {}
	for _, client in ipairs(json.array(all_clients_json)) do
		local stable_id = tostring(client.stableId or "")
		local address = tostring(client.address or ""):gsub("^0x", "")
		if stable_id ~= "" then
			live_preview_ids[stable_id] = true
		end
		if address ~= "" then
			live_preview_ids[address] = true
		end
	end

	local previews =
		command.output("find " .. command.arg(screenshot_dir) .. " -maxdepth 1 -name '*.jpg' -type f 2>/dev/null")
	for preview_path in previews:gmatch("[^\n]+") do
		local preview_id = preview_path:match("([^/]+)%.jpg$")
		if preview_id and not live_preview_ids[preview_id] then
			remove_file(preview_path)
		end
	end
end

local function calculate_capture_scale(width, height)
	if width <= 0 or height <= 0 then
		return "1.0"
	end

	local scale = math.min(preview_target_max_width / width, preview_target_height / height)
	if scale > 1.0 or scale <= 0.0 then
		scale = 1.0
	end

	return string.format("%.4f", scale)
end

local function frame_is_too_dark(image_path)
	if not command_exists("magick") then
		return false
	end

	local command_line = "magick "
		.. command.arg(image_path)
		.. " -colorspace Gray -format '%[fx:floor(mean*1000)]' info: 2>/dev/null"
	local output
	if command_exists("timeout") then
		output = command.output("timeout --kill-after=1 1s " .. command_line)
	else
		output = command.output(command_line)
	end

	local mean_brightness = tonumber(output)
	return mean_brightness ~= nil and mean_brightness < black_frame_mean_threshold
end

function capture_window_preview(preview_id, width, height)
	if preview_id == "" or width <= 0 or height <= 0 then
		return
	end

	local filename = preview_id .. ".jpg"
	local temp_output = screenshot_dir .. "/.temp_" .. filename
	local output_path = screenshot_dir .. "/" .. filename
	local command = table.concat({
		"grim -t jpeg -q",
		tostring(jpeg_quality),
		"-s",
		command.arg(calculate_capture_scale(width, height)),
		"-T",
		command.arg(preview_id),
		command.arg(temp_output),
		"2>/dev/null",
	}, " ")

	if not run_with_timeout(grim_timeout_s, command) then
		remove_file(temp_output)
		return
	end

	if not file_is_nonempty(temp_output) or frame_is_too_dark(temp_output) then
		remove_file(temp_output)
		return
	end

	os.rename(temp_output, output_path)
end

local function capture_window_preview_command(preview_id, width, height)
	local filename = preview_id .. ".jpg"
	local temp_output = screenshot_dir .. "/.temp_" .. filename
	local output_path = screenshot_dir .. "/" .. filename
	local grim_command = table.concat({
		"grim -t jpeg -q",
		tostring(jpeg_quality),
		"-s",
		command.arg(calculate_capture_scale(width, height)),
		"-T",
		command.arg(preview_id),
		command.arg(temp_output),
		"2>/dev/null",
	}, " ")

	if command_exists("timeout") then
		grim_command = "timeout --kill-after=1 " .. command.arg(tostring(grim_timeout_s) .. "s") .. " " .. grim_command
	end

	local parts = {
		grim_command .. " || { rm -f " .. command.arg(temp_output) .. "; exit 0; }",
		"[ -s " .. command.arg(temp_output) .. " ] || { rm -f " .. command.arg(temp_output) .. "; exit 0; }",
	}

	if command_exists("magick") then
		local magick_command = "magick "
			.. command.arg(temp_output)
			.. " -colorspace Gray -format '%[fx:floor(mean*1000)]' info: 2>/dev/null"
		if command_exists("timeout") then
			magick_command = "timeout --kill-after=1 1s " .. magick_command
		end

		parts[#parts + 1] = "mean=$(" .. magick_command .. " || printf '')"
		parts[#parts + 1] = "case $mean in ''|*[!0-9]*) ;; *) [ \"$mean\" -lt "
			.. tostring(black_frame_mean_threshold)
			.. " ] && { rm -f "
			.. command.arg(temp_output)
			.. "; exit 0; } ;; esac"
	end

	parts[#parts + 1] = "mv " .. command.arg(temp_output) .. " " .. command.arg(output_path)
	return table.concat(parts, "; ")
end

local function capture_window_preview_command_for_window(preview_id, width, height)
	if preview_id == "" or width <= 0 or height <= 0 then
		return nil
	end

	return capture_window_preview_command(preview_id, width, height)
end

local function capture_window_preview_batch(commands)
	if #commands == 0 then
		return
	end

	local processes = {}
	for _, capture_command in ipairs(commands) do
		processes[#processes + 1] = "( " .. capture_command .. " )"
	end

	command.ok("sh -c " .. command.arg(table.concat(processes, " & ") .. " & wait"))
end

local function capture_active_window_preview()
	local active_window_json = query("j/activewindow")
	if active_window_json == "" or active_window_json == "{}" then
		return
	end

	capture_preview_for_window(json.object(active_window_json))
end

local function capture_window_preview_by_address(address)
	address = (address or ""):gsub("^0x", "")
	if address == "" then
		return
	end

	local all_clients_json = query("j/clients")
	if all_clients_json == "" then
		return
	end

	for _, client in ipairs(json.array(all_clients_json)) do
		if tostring(client.address or ""):gsub("^0x", "") == address then
			capture_preview_for_window(client)
			return
		end
	end
end

local function visible_workspace_ids()
	local monitors_json = query("j/monitors")
	if monitors_json == "" then
		return {}
	end

	local visible = {}
	for _, monitor in ipairs(json.array(monitors_json)) do
		local workspace_id = monitor.activeWorkspace and monitor.activeWorkspace.id
		if type(workspace_id) == "number" then
			visible[workspace_id] = true
		end
	end
	return visible
end

local function capture_visible_workspace_previews(missing_only)
	local all_clients_json = query("j/clients")
	if all_clients_json == "" then
		return
	end

	local visible_workspaces = visible_workspace_ids()
	local capture_commands = {}
	for _, client in ipairs(json.array(all_clients_json)) do
		local workspace_id = client.workspace and client.workspace.id
		local preview_id, mapped, width, height = window_preview_fields(client)
		if visible_workspaces[workspace_id] and mapped and preview_id ~= "" then
			if not missing_only or not file_is_nonempty(screenshot_dir .. "/" .. preview_id .. ".jpg") then
				local capture_command = capture_window_preview_command_for_window(preview_id, width, height)
				if capture_command then
					capture_commands[#capture_commands + 1] = capture_command
				end

				if #capture_commands >= max_parallel_captures then
					capture_window_preview_batch(capture_commands)
					capture_commands = {}
				end
			end
		end
	end

	if #capture_commands > 0 then
		capture_window_preview_batch(capture_commands)
	end
end

local function maybe_run_healthcheck()
	local now = now_ms()
	local last = read_number(last_healthcheck_file)
	if last and now - last >= 0 and now - last < healthcheck_interval_ms then
		return false
	end

	cleanup_stale_temp_files()
	cleanup_stale_preview_files()
	write_file(last_healthcheck_file, tostring(now))
	return true
end

local function capture_screenshot(event_type, capture_id, event_payload)
	local last_time = read_number(last_screenshot_file)
	if last_time then
		local elapsed = now_ms() - last_time
		if elapsed < 0 then
			remove_file(last_screenshot_file)
		elseif elapsed < debounce_ms then
			return
		end
	end

	local delay_ms = capture_delay_ms
	if event_type == "workspace" then
		delay_ms = workspace_delay_ms
	elseif event_type == "windowsettle" then
		delay_ms = window_settle_delay_ms
	end

	local elapsed_sleep = 0
	while elapsed_sleep < delay_ms do
		local sleep_ms = math.min(20, delay_ms - elapsed_sleep)
		socket.sleep(sleep_ms / 1000)
		elapsed_sleep = elapsed_sleep + sleep_ms
		local current_change_id = kit:read_file(workspace_change_file)
		if current_change_id and current_change_id:gsub("%s+$", "") ~= capture_id then
			return
		end
	end

	write_file(last_screenshot_file, tostring(now_ms()))
	if event_type == "activewindow" then
		capture_active_window_preview()
		capture_visible_workspace_previews(true)
		return
	end

	if event_type == "windowupdate" then
		capture_window_preview_by_address(event_payload or "")
		return
	end

	if event_type == "windowtitle" then
		capture_window_preview_by_address(event_payload or "")
		return
	end

	capture_visible_workspace_previews(false)
	cleanup_stale_preview_files()
end

local function event_type_for(line)
	if line:match("^activewindowv2") then
		return "activewindow"
	elseif line:match("^workspacev2") then
		return "workspace"
	elseif line:match("^openwindow") then
		return "windowupdate", line:match("^[^>,]+>>([^,]+)") or line:match("^[^,]+,([^,]+)") or ""
	elseif line:match("^windowtitlev2") then
		return "windowtitle", line:match("^[^>,]+>>([^,]+)") or line:match("^[^,]+,([^,]+)") or ""
	elseif
		line:match("^movewindowv2")
		or line:match("^changefloatingmode")
		or line:match("^fullscreen")
		or line:match("^fullscreenv2")
	then
		return "windowsettle"
	elseif line:match("^closewindow") then
		return "closewindow", line:match("^[^>,]+>>(.+)$") or line:match("^[^,]+,(.+)$") or ""
	end

	return nil
end

local function remove_closed_window_preview(address)
	if address == "" then
		return
	end

	local preview_id = address:gsub("^0x", "")
	remove_file(screenshot_dir .. "/" .. preview_id .. ".jpg")
end

local function handle_event(line, capture_id, worker_owned)
	local event_type, event_payload = event_type_for(line or "")
	if not event_type then
		return
	end

	if event_type == "closewindow" then
		remove_closed_window_preview(event_payload)
		maybe_run_healthcheck()
		return
	end

	maybe_run_healthcheck()

	if worker_owned == false then
		local lock_ts = read_number(capture_lock_file)
		if lock_ts then
			local lock_age = now_ms() - lock_ts
			if lock_age < 0 then
				remove_file(capture_lock_file)
			elseif lock_age < lock_stale_ms then
				return
			else
				remove_file(capture_lock_file)
			end
		end
	end

	local timestamp = now_ms()
	capture_id = capture_id or (tostring(timestamp) .. "_" .. event_type)
	if worker_owned == false then
		write_file(capture_lock_file, tostring(timestamp))
	end
	write_file(last_event_file, tostring(timestamp))
	write_file(workspace_change_file, capture_id)
	local ok, err = xpcall(function()
		capture_screenshot(event_type, capture_id, event_payload)
	end, debug.traceback)
	if worker_owned == false then
		remove_file(capture_lock_file)
	end
	if not ok then
		io.stderr:write("window capture failed: ", err, "\n")
	end
end

local function current_pid()
	local stat = kit:read_file("/proc/self/stat") or ""
	return stat:match("^(%d+)") or ""
end

local function current_start_time()
	local stat = kit:read_file("/proc/self/stat") or ""
	local fields = {}
	local remainder = stat:match("^%d+ %b() (.+)$") or ""
	for field in remainder:gmatch("[^ ]+") do
		fields[#fields + 1] = field
	end

	return fields[20] or ""
end

local function pid_is_running(pid)
	return process_is_running(pid)
end

local function acquire_daemon_lock()
	if command.ok("mkdir " .. command.arg(daemon_lock_dir) .. " 2>/dev/null") then
		write_file(daemon_lock_dir .. "/pid", current_pid())
		write_file(daemon_lock_dir .. "/owner", current_pid() .. "\t" .. current_start_time())
		return true
	end

	local pid = kit:read_file(daemon_lock_dir .. "/pid") or ""
	pid = pid:gsub("%s+$", "")
	if pid_is_running(pid) then
		return false
	end

	command.ok("rm -rf " .. command.arg(daemon_lock_dir) .. " 2>/dev/null")
	if command.ok("mkdir " .. command.arg(daemon_lock_dir) .. " 2>/dev/null") then
		write_file(daemon_lock_dir .. "/pid", current_pid())
		write_file(daemon_lock_dir .. "/owner", current_pid() .. "\t" .. current_start_time())
		return true
	end

	return false
end

local function worker_owner(lock_dir)
	local owner = kit:read_file((lock_dir or worker_lock_dir) .. "/owner") or ""
	local pid, token = owner:match("^(%d+)\t([^\n]+)")
	return pid or "", token or ""
end

local function release_worker_lock(expected_token)
	write_sequence = write_sequence + 1
	local retiring_dir = worker_lock_dir .. ".retiring." .. tostring(ffi.C.getpid()) .. "." .. tostring(write_sequence)
	if not os.rename(worker_lock_dir, retiring_dir) then
		return
	end

	local _, token = worker_owner(retiring_dir)
	if token ~= expected_token then
		os.rename(retiring_dir, worker_lock_dir)
		return
	end

	command.ok("rm -rf " .. command.arg(retiring_dir) .. " 2>/dev/null")
end

local function acquire_worker_lock()
	if command.ok("mkdir " .. command.arg(worker_lock_dir) .. " 2>/dev/null") then
		return true
	end

	local pid = worker_owner()
	if pid == "" then
		socket.sleep(worker_lock_initialization_grace_ms / 1000)
		pid = worker_owner()
		if pid == "" then
			return false
		end
	end

	if pid_is_running(pid) then
		return false
	end

	command.ok("rm -rf " .. command.arg(worker_lock_dir) .. " 2>/dev/null")
	return command.ok("mkdir " .. command.arg(worker_lock_dir) .. " 2>/dev/null")
end

local function write_pending_event(capture_id, line)
	write_file(pending_event_file, capture_id .. "\t" .. line)
end

local run_capture_worker

local function reap_capture_worker()
	if not worker_pid then
		return false
	end

	local status = ffi.new("int[1]")
	local result = ffi.C.waitpid(worker_pid, status, wnohang)
	if result ~= worker_pid then
		return false
	end

	release_worker_lock(worker_token)
	worker_pid = nil
	worker_token = nil
	return true
end

local function start_capture_worker()
	reap_capture_worker()
	if worker_pid then
		return
	end

	if acquire_worker_lock() == false then
		return
	end

	local token = tostring(ffi.C.getpid()) .. "-" .. tostring(now_ms())
	write_file(worker_lock_dir .. "/owner", tostring(ffi.C.getpid()) .. "\t" .. token)
	local pid = ffi.C.fork()
	if pid < 0 then
		release_worker_lock(token)
		io.stderr:write("window-capture: failed to fork worker\n")
		return
	end

	if pid == 0 then
		if ffi.C.setpgid(0, 0) ~= 0 then
			os.exit(1)
		end
		local ok, err = xpcall(run_capture_worker, debug.traceback)
		if not ok then
			io.stderr:write("window-capture: worker failed: ", err, "\n")
		end
		os.exit(ok and 0 or 1)
	end

	if ffi.C.setpgid(pid, pid) ~= 0 then
		ffi.C.kill(pid, sigterm)
		local status = ffi.new("int[1]")
		ffi.C.waitpid(pid, status, 0)
		release_worker_lock(token)
		log("failed to create worker process group")
		return
	end

	worker_pid = tonumber(pid)
	worker_token = token
	write_file(worker_lock_dir .. "/owner", tostring(worker_pid) .. "\t" .. token)
end

local function enqueue_event(line)
	local event_type, event_payload = event_type_for(line or "")
	if not event_type then
		return
	end

	if event_type == "closewindow" then
		remove_closed_window_preview(event_payload)
		return
	end

	local capture_id = tostring(now_ms()) .. "_" .. event_type
	write_file(workspace_change_file, capture_id)
	write_pending_event(capture_id, line)
	start_capture_worker()
end

run_capture_worker = function()
	-- The reader overwrites pending state while this worker captures the latest event.
	while true do
		local pending_event = kit:read_file(pending_event_file)
		if pending_event then
			remove_file(pending_event_file)
			local capture_id, line = pending_event:match("^([^\t]+)\t(.*)$")
			if capture_id and line then
				handle_event(line, capture_id, true)
			end
		else
			return
		end
	end
end

local function stop_capture_worker()
	if not worker_pid then
		return
	end

	ffi.C.kill(-worker_pid, sigterm)
	local deadline = now_ms() + worker_shutdown_wait_ms
	while now_ms() < deadline do
		if reap_capture_worker() then
			return
		end
		socket.sleep(0.01)
	end

	ffi.C.kill(-worker_pid, sigkill)
	local status = ffi.new("int[1]")
	ffi.C.waitpid(worker_pid, status, 0)
	release_worker_lock(worker_token)
	worker_pid = nil
	worker_token = nil
end

local function run_event_loop()
	local connection_failed = false
	while true do
		local ok, client = pcall(kit.connect_events, kit, {
			connect_timeout = event_reconnect_delay_s,
			read_timeout = event_read_timeout_s,
		})
		if not ok then
			if connection_failed == false then
				log("event socket unavailable; retrying")
				connection_failed = true
			end
			socket.sleep(event_reconnect_delay_s)
		else
			if connection_failed then
				log("event socket reconnected")
				connection_failed = false
			end
			while true do
				reap_capture_worker()
				local line, err, partial = client:receive("*l")
				line = line or partial
				if line and line ~= "" then
					enqueue_event(line)
				end
				if err == "timeout" then
					if kit:read_file(pending_event_file) then
						start_capture_worker()
					end
				elseif err == "closed" then
					client:close()
					log("event socket closed; retrying")
					connection_failed = true
					socket.sleep(event_reconnect_delay_s)
					break
				elseif err then
					client:close()
					log("event socket read failed; retrying")
					connection_failed = true
					socket.sleep(event_reconnect_delay_s)
					break
				end
			end
		end
	end
end

local function cleanup_daemon()
	stop_capture_worker()
	command.ok("rm -rf " .. command.arg(daemon_lock_dir) .. " 2>/dev/null")
end

local function usage()
	io.stderr:write("usage: ", arg[0], " [daemon|refresh-once|handle-event EVENT|worker]\n")
end

mkdir(screenshot_dir)
command.ok("find " .. command.arg(screenshot_dir) .. " -maxdepth 1 -name '.temp_*.jpg' -type f -delete 2>/dev/null")

if mode == "refresh-once" then
	remove_file(last_screenshot_file)
	handle_event("workspacev2>>refresh-once", nil, false)
elseif mode == "handle-event" then
	handle_event(arg[2] or "", nil, false)
elseif mode == "worker" then
	run_capture_worker()
elseif mode == "daemon" then
	if not acquire_daemon_lock() then
		os.exit(0)
	end
	local ok, err = xpcall(run_event_loop, debug.traceback)
	cleanup_daemon()
	if not ok then
		log("daemon failed: " .. err)
		os.exit(1)
	end
else
	usage()
	os.exit(1)
end
