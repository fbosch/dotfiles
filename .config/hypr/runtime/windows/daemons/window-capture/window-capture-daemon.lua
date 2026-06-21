#!/usr/bin/env lua

local socket = require("socket")

local config_dir = os.getenv("HOME") .. "/.config/hypr"
local json = dofile(config_dir .. "/lib/json.lua")
local hypr_ipc = dofile(config_dir .. "/runtime/lib/hypr-ipc.lua")
local ags_ipc = dofile(config_dir .. "/runtime/lib/ags-ipc.lua")

local mode = arg[1] or "daemon"
local runtime_dir = os.getenv("XDG_RUNTIME_DIR") or "/tmp"
local screenshot_dir = "/tmp/hypr-window-captures"
if os.execute("test -d /dev/shm >/dev/null 2>&1") then
	screenshot_dir = "/dev/shm/hypr-window-captures"
end

local daemon_lock_dir = runtime_dir .. "/hypr-window-capture-daemon.lock.d"
local last_screenshot_file = screenshot_dir .. "/.last_screenshot"
local last_event_file = screenshot_dir .. "/.last_event"
local last_overlay_file = screenshot_dir .. "/.last_overlay"
local capture_lock_file = screenshot_dir .. "/.capture_lock"
local workspace_change_file = screenshot_dir .. "/.workspace_change"
local last_healthcheck_file = screenshot_dir .. "/.last_healthcheck"

local debounce_ms = 100
local overlay_cooldown_ms = 5
local capture_delay_ms = 50
local window_settle_delay_ms = 150
local workspace_delay_ms = 100
local lock_stale_ms = 10000
local healthcheck_interval_ms = 5000
local temp_file_max_age_s = 30
local grim_timeout_s = 2
local max_parallel_captures = 4
local black_frame_mean_threshold = 10
local jpeg_quality = 85
local preview_target_height = 180
local preview_target_max_width = 320
local command_cache = {}
local capture_window_preview

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function command_ok(command)
	local ok, _, code = os.execute(command)
	return ok == true or ok == 0 or code == 0
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

local function command_exists(name)
	if command_cache[name] ~= nil then
		return command_cache[name]
	end

	command_cache[name] = command_ok("command -v " .. shell_quote(name) .. " >/dev/null 2>&1")
	return command_cache[name]
end

local function process_is_running(pid)
	return pid ~= "" and command_ok("kill -0 " .. shell_quote(pid) .. " 2>/dev/null")
end

local function run_with_timeout(timeout_s, command)
	if command_exists("timeout") then
		return command_ok("timeout --kill-after=1 " .. shell_quote(tostring(timeout_s) .. "s") .. " " .. command)
	end

	return command_ok(command)
end

local function now_ms()
	return math.floor(socket.gettime() * 1000)
end

local function read_file(path)
	local handle = io.open(path, "r")
	if not handle then
		return nil
	end

	local content = handle:read("*a")
	handle:close()
	return content
end

local function read_number(path)
	return tonumber(read_file(path) or "")
end

local function write_file(path, content)
	local handle = assert(io.open(path, "w"))
	handle:write(content)
	handle:close()
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
	command_ok("mkdir -p " .. shell_quote(path) .. " >/dev/null 2>&1")
end

local function query(request)
	local ok, response = pcall(hypr_ipc.request, request, { timeout = 0.5 })
	if ok and response and response ~= "" then
		return response
	end

	local fallback = {
		["j/activewindow"] = "hyprctl activewindow -j 2>/dev/null",
		["j/clients"] = "hyprctl clients -j 2>/dev/null",
		["j/monitors"] = "hyprctl monitors -j 2>/dev/null",
	}

	if fallback[request] then
		return command_output(fallback[request])
	end

	return ""
end

local function decode_json(content, fallback)
	local ok, decoded = pcall(json.decode, content or "")
	if ok and type(decoded) == "table" then
		return decoded
	end

	return fallback
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
	command_ok(
		"find "
			.. shell_quote(screenshot_dir)
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
	for _, client in ipairs(decode_json(all_clients_json, {})) do
		local stable_id = tostring(client.stableId or "")
		local address = tostring(client.address or ""):gsub("^0x", "")
		if stable_id ~= "" then
			live_preview_ids[stable_id] = true
		end
		if address ~= "" then
			live_preview_ids[address] = true
		end
	end

	local previews = command_output("find " .. shell_quote(screenshot_dir) .. " -maxdepth 1 -name '*.jpg' -type f 2>/dev/null")
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

	local command = "magick "
		.. shell_quote(image_path)
		.. " -colorspace Gray -format '%[fx:floor(mean*1000)]' info: 2>/dev/null"
	local output
	if command_exists("timeout") then
		output = command_output("timeout --kill-after=1 1s " .. command)
	else
		output = command_output(command)
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
		shell_quote(calculate_capture_scale(width, height)),
		"-T",
		shell_quote(preview_id),
		shell_quote(temp_output),
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
		shell_quote(calculate_capture_scale(width, height)),
		"-T",
		shell_quote(preview_id),
		shell_quote(temp_output),
		"2>/dev/null",
	}, " ")

	if command_exists("timeout") then
		grim_command = "timeout --kill-after=1 " .. shell_quote(tostring(grim_timeout_s) .. "s") .. " " .. grim_command
	end

	local parts = {
		grim_command .. " || { rm -f " .. shell_quote(temp_output) .. "; exit 0; }",
		"[ -s " .. shell_quote(temp_output) .. " ] || { rm -f " .. shell_quote(temp_output) .. "; exit 0; }",
	}

	if command_exists("magick") then
		local magick_command = "magick "
			.. shell_quote(temp_output)
			.. " -colorspace Gray -format '%[fx:floor(mean*1000)]' info: 2>/dev/null"
		if command_exists("timeout") then
			magick_command = "timeout --kill-after=1 1s " .. magick_command
		end

		parts[#parts + 1] = "mean=$(" .. magick_command .. " || printf '')"
		parts[#parts + 1] = "case $mean in ''|*[!0-9]*) ;; *) [ \"$mean\" -lt "
			.. tostring(black_frame_mean_threshold)
			.. " ] && { rm -f "
			.. shell_quote(temp_output)
			.. "; exit 0; } ;; esac"
	end

	parts[#parts + 1] = "mv " .. shell_quote(temp_output) .. " " .. shell_quote(output_path)
	return table.concat(parts, "; ")
end

local function spawn_capture_window_preview(preview_id, width, height)
	if preview_id == "" or width <= 0 or height <= 0 then
		return nil
	end

	local command = capture_window_preview_command(preview_id, width, height)
	local handle = io.popen("sh -c " .. shell_quote("( " .. command .. " ) & printf '%s\n' \"$!\""), "r")
	if not handle then
		return nil
	end

	local pid = handle:read("*l") or ""
	handle:close()
	return pid ~= "" and pid or nil
end

local function wait_for_capture(pid)
	while process_is_running(pid) do
		socket.sleep(0.02)
	end
end

local function wait_for_capture_batch(pids)
	for _, pid in ipairs(pids) do
		wait_for_capture(pid)
	end
end

local function capture_active_window_preview()
	local active_window_json = query("j/activewindow")
	if active_window_json == "" or active_window_json == "{}" then
		return
	end

	capture_preview_for_window(decode_json(active_window_json, {}))
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

	for _, client in ipairs(decode_json(all_clients_json, {})) do
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
	for _, monitor in ipairs(decode_json(monitors_json, {})) do
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
	local capture_pids = {}
	for _, client in ipairs(decode_json(all_clients_json, {})) do
		local workspace_id = client.workspace and client.workspace.id
		local preview_id, mapped, width, height = window_preview_fields(client)
		if visible_workspaces[workspace_id] and mapped and preview_id ~= "" then
			if not missing_only or not file_is_nonempty(screenshot_dir .. "/" .. preview_id .. ".jpg") then
				local pid = spawn_capture_window_preview(preview_id, width, height)
				if pid then
					capture_pids[#capture_pids + 1] = pid
				end

				if #capture_pids >= max_parallel_captures then
					wait_for_capture_batch(capture_pids)
					capture_pids = {}
				end
			end
		end
	end

	if #capture_pids > 0 then
		wait_for_capture_batch(capture_pids)
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

local function is_any_overlay_visible()
	local ok, response = pcall(ags_ipc.request, "window-switcher", '{"action":"get-visibility"}')
	if not ok then
		response = ""
	end

	response = response:gsub("%s+$", "")
	if response == "visible" then
		write_file(last_overlay_file, tostring(now_ms()))
		return true
	end

	return false
end

local function is_in_overlay_cooldown()
	local last_overlay_time = read_number(last_overlay_file)
	if not last_overlay_time then
		return false
	end

	local elapsed = now_ms() - last_overlay_time
	return elapsed >= 0 and elapsed < overlay_cooldown_ms
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

	if is_any_overlay_visible() or is_in_overlay_cooldown() then
		return
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
		local current_change_id = read_file(workspace_change_file)
		if current_change_id and current_change_id:gsub("%s+$", "") ~= capture_id then
			return
		end
	end

	if is_any_overlay_visible() then
		return
	end

	write_file(last_screenshot_file, tostring(now_ms()))
	if event_type == "activewindow" then
		capture_active_window_preview()
		capture_visible_workspace_previews(true)
		remove_file(capture_lock_file)
		return
	end

	if event_type == "windowupdate" then
		capture_active_window_preview()
		capture_visible_workspace_previews(true)
		remove_file(capture_lock_file)
		return
	end

	if event_type == "windowtitle" then
		capture_window_preview_by_address(event_payload or "")
		remove_file(capture_lock_file)
		return
	end

	capture_visible_workspace_previews(false)
	cleanup_stale_preview_files()
	remove_file(capture_lock_file)
end

local function event_type_for(line)
	if line:match("^activewindow") or line:match("^activewindowv2") then
		return "activewindow"
	elseif line:match("^workspace") or line:match("^workspacev2") then
		return "workspace"
	elseif line:match("^openwindow") or line:match("^openwindowv2") then
		return "windowupdate"
	elseif line:match("^windowtitle") or line:match("^windowtitlev2") then
		return "windowtitle", line:match("^[^>,]+>>([^,]+)") or line:match("^[^,]+,([^,]+)") or ""
	elseif line:match("^movewindow")
		or line:match("^movewindowv2")
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

local function handle_event(line)
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

	local timestamp = now_ms()
	local capture_id = tostring(timestamp) .. "_" .. event_type
	write_file(capture_lock_file, tostring(timestamp))
	write_file(last_event_file, tostring(timestamp))
	write_file(workspace_change_file, capture_id)
	capture_screenshot(event_type, capture_id, event_payload)
end

local function current_pid()
	local stat = read_file("/proc/self/stat") or ""
	return stat:match("^(%d+)") or ""
end

local function pid_is_running(pid)
	return process_is_running(pid)
end

local function acquire_daemon_lock()
	if command_ok("mkdir " .. shell_quote(daemon_lock_dir) .. " 2>/dev/null") then
		write_file(daemon_lock_dir .. "/pid", current_pid())
		return true
	end

	local pid = read_file(daemon_lock_dir .. "/pid") or ""
	pid = pid:gsub("%s+$", "")
	if pid_is_running(pid) then
		return false
	end

	command_ok("rm -rf " .. shell_quote(daemon_lock_dir) .. " 2>/dev/null")
	if command_ok("mkdir " .. shell_quote(daemon_lock_dir) .. " 2>/dev/null") then
		write_file(daemon_lock_dir .. "/pid", current_pid())
		return true
	end

	return false
end

local function run_event_loop()
	while true do
		local ok, client = pcall(hypr_ipc.connect_event_socket, { connect_timeout = 0.5 })
		if not ok then
			socket.sleep(0.5)
		else
			while true do
				local line, err, partial = client:receive("*l")
				line = line or partial
				if line and line ~= "" and event_type_for(line) then
					handle_event(line)
				end
				if err == "closed" then
					client:close()
					break
				elseif err then
					client:close()
					socket.sleep(0.5)
					break
				end
			end
		end
	end
end

local function usage()
	io.stderr:write("usage: ", arg[0], " [daemon|refresh-once|handle-event EVENT]\n")
end

mkdir(screenshot_dir)
command_ok("find " .. shell_quote(screenshot_dir) .. " -maxdepth 1 -name '.temp_*.jpg' -type f -delete 2>/dev/null")

if mode == "refresh-once" then
	remove_file(last_overlay_file)
	remove_file(last_screenshot_file)
	handle_event("workspace>>refresh-once")
elseif mode == "handle-event" then
	handle_event(arg[2] or "")
elseif mode == "daemon" then
	if not acquire_daemon_lock() then
		os.exit(0)
	end
	run_event_loop()
else
	usage()
	os.exit(1)
end
