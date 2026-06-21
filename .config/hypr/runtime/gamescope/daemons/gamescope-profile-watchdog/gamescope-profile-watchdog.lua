#!/usr/bin/env lua

local socket = require("socket")

local home = os.getenv("HOME")
local json = dofile(home .. "/.config/hypr/lib/json.lua")
local hypr_ipc = dofile(home .. "/.config/hypr/runtime/lib/hypr-ipc.lua")
local profilectl = home .. "/.config/hypr/runtime/profiles/profilectl.sh"
local reconnect_delay_seconds = 1
local event_idle_timeout_seconds = 5
local gaming_workspace = "10"
local minimized_workspace_prefix = "special:minimized"
local gaming_overlay_workspace = "special:gaming-overlay"
local profile_excluded_title_pattern = "[Ff]augus"
local freeze_excluded_title_pattern = "^(World of Warcraft|Battle[.]net( .*)?)$"
local wl_freeze_checked = false
local wl_freeze_available = false

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function profile_sync(count)
	os.execute(shell_quote(profilectl) .. " sync gaming " .. shell_quote(count) .. " >/dev/null 2>&1")
end

local function command_ok(command)
	local ok = os.execute(command .. " >/dev/null 2>&1")
	return ok == true or ok == 0
end

local function decode_array(content)
	local ok, decoded = pcall(json.decode, content or "[]")
	if not ok or type(decoded) ~= "table" then
		return {}
	end

	return decoded
end

local function get_clients()
	local ok, clients = pcall(hypr_ipc.request, "j/clients")
	if ok and clients and clients ~= "" then
		return decode_array(clients)
	end
	return {}
end

local function get_monitors()
	local ok, monitors = pcall(hypr_ipc.request, "j/monitors")
	if ok and monitors and monitors ~= "" then
		return decode_array(monitors)
	end
	return {}
end

local function workspace_name(client)
	return client.workspace and client.workspace.name or ""
end

local function lower(value)
	return tostring(value or ""):lower()
end

local function starts_with(value, prefix)
	return tostring(value or ""):sub(1, #prefix) == prefix
end

local function is_gaming_class(value)
	local class = lower(value)
	return class == "gamescope" or class:match("^steam_app_%d+$") ~= nil
end

local function matches_profile_excluded_title(value)
	return tostring(value or ""):match(profile_excluded_title_pattern) ~= nil
end

local function matches_freeze_excluded_title(value)
	value = tostring(value or "")
	return value == "World of Warcraft" or value == "Battle.net" or value:match("^Battle%.net .*$") ~= nil
end

local function has_gaming_class(client)
	return is_gaming_class(client.class) or is_gaming_class(client.initialClass)
end

local function has_profile_excluded_title(client)
	return matches_profile_excluded_title(client.title) or matches_profile_excluded_title(client.initialTitle)
end

local function has_freeze_excluded_title(client)
	return matches_freeze_excluded_title(client.title) or matches_freeze_excluded_title(client.initialTitle)
end

local function get_gaming_window_count(clients)
	local count = 0
	for _, client in ipairs(clients or get_clients()) do
		if
			not starts_with(workspace_name(client), minimized_workspace_prefix)
			and not has_profile_excluded_title(client)
			and has_gaming_class(client)
		then
			count = count + 1
		end
	end
	return count
end

local function get_freezable_gaming_windows(clients)
	local windows = {}
	for _, client in ipairs(clients or get_clients()) do
		local workspace = workspace_name(client)
		if
			(workspace == gaming_workspace or starts_with(workspace, minimized_workspace_prefix))
			and not has_freeze_excluded_title(client)
			and has_gaming_class(client)
		then
			windows[#windows + 1] = { pid = tostring(client.pid or ""), workspace = workspace }
		end
	end

	return windows
end

local function workspace_visible(workspace, monitors)
	local monitor_field = "activeWorkspace"
	if starts_with(workspace, "special:") then
		monitor_field = "specialWorkspace"
	end

	for _, monitor in ipairs(monitors or get_monitors()) do
		local active_workspace = monitor[monitor_field]
		if active_workspace and active_workspace.name == workspace then
			return true
		end
	end
	return false
end

local function process_state(pid)
	if not pid or not pid:match("^[0-9]+$") then
		return ""
	end

	local handle = io.popen("ps -p " .. pid .. " -o state= 2>/dev/null", "r")
	local output = handle and handle:read("*a") or ""
	if handle then
		handle:close()
	end
	return (output:gsub("%s+", ""))
end

local function can_wl_freeze()
	if not wl_freeze_checked then
		wl_freeze_available = command_ok("command -v wl-freeze")
		wl_freeze_checked = true
	end
	return wl_freeze_available
end

local function set_process_frozen(pid, should_freeze)
	if not pid or pid == "" or not can_wl_freeze() then
		return
	end

	local state = process_state(pid)
	if state == "" then
		return
	end

	local is_frozen = state:match("^T") ~= nil
	if is_frozen == should_freeze then
		return
	end

	os.execute("wl-freeze -p " .. pid .. " -s >/dev/null 2>&1")
end

local function sync_gaming_freeze_state(clients, monitors)
	local windows = get_freezable_gaming_windows(clients)
	if #windows == 0 then
		return
	end

	monitors = monitors or get_monitors()

	local should_freeze_by_pid = {}
	for _, window in ipairs(windows) do
		local visible = workspace_visible(window.workspace, monitors)
		if should_freeze_by_pid[window.pid] == nil then
			should_freeze_by_pid[window.pid] = true
		end
		if visible then
			should_freeze_by_pid[window.pid] = false
		end
	end

	for pid, should_freeze in pairs(should_freeze_by_pid) do
		set_process_frozen(pid, should_freeze)
	end
end

local function sync_gaming_state(last_count, clients, force)
	local count = get_gaming_window_count(clients)
	if force or count ~= last_count then
		profile_sync(count)
		return count
	end
	return last_count
end

local function overlay_window_count(clients)
	local count = 0
	for _, client in ipairs(clients or get_clients()) do
		if workspace_name(client) == gaming_overlay_workspace then
			count = count + 1
		end
	end
	return count
end

local function lua_string(value)
	return string.format("%q", value)
end

local function maybe_show_gaming_overlay(current_count, last_count, monitors)
	if current_count <= last_count then
		return
	end

	monitors = monitors or get_monitors()
	local target_monitor = ""
	for _, monitor in ipairs(monitors) do
		local active_workspace = monitor.activeWorkspace
		if active_workspace and active_workspace.name == gaming_workspace then
			target_monitor = monitor.name or ""
			break
		end
	end
	if target_monitor == "" then
		return
	end

	for _, monitor in ipairs(monitors) do
		local special_workspace = monitor.specialWorkspace
		if
			monitor.name == target_monitor
			and special_workspace
			and special_workspace.name == gaming_overlay_workspace
		then
			return
		end
	end

	hypr_ipc.request("dispatch hl.dsp.focus({ monitor = " .. lua_string(target_monitor) .. " })")
	hypr_ipc.request(
		"dispatch hl.dsp.workspace.toggle_special(" .. lua_string(gaming_overlay_workspace:gsub("^special:", "")) .. ")"
	)
end

local function event_kind(event)
	if event:match("^configreloaded") then
		return "reload"
	end
	if
		event:match("^openwindow")
		or event:match("^closewindow")
		or event:match("^movewindow")
		or event:match("^workspace")
		or event:match("^activespecial")
		or event:match("^activewindow")
		or event:match("^fullscreen")
	then
		return "window"
	end
	return nil
end

local function cleanup()
	profile_sync(0)
end

local function run()
	local last_count = nil
	local last_overlay_count = 0

	while true do
		local ok, err = pcall(function()
			local events = hypr_ipc.connect_event_socket({ read_timeout = event_idle_timeout_seconds })
			local clients = get_clients()
			local monitors = get_monitors()
			last_overlay_count = overlay_window_count(clients)
			sync_gaming_freeze_state(clients, monitors)
			last_count = sync_gaming_state(last_count, clients, true)

			while true do
				local line, read_err, partial = events:receive("*l")
				line = line or partial
				local kind = line and event_kind(line) or nil
				if kind then
					local clients = get_clients()
					local current_overlay_count = overlay_window_count(clients)
					local monitors = nil
					if current_overlay_count > last_overlay_count or kind == "window" then
						monitors = get_monitors()
					end

					maybe_show_gaming_overlay(current_overlay_count, last_overlay_count, monitors)
					sync_gaming_freeze_state(clients, monitors)
					last_overlay_count = current_overlay_count
					last_count = sync_gaming_state(last_count, clients, kind == "reload")
				end
				if read_err then
					events:close()
					break
				end
			end
		end)
		if not ok then
			io.stderr:write("gamescope-profile-watchdog: ", tostring(err), "\n")
		end
		socket.sleep(reconnect_delay_seconds)
	end
end

local ok, err = xpcall(run, debug.traceback)
if not ok then
	io.stderr:write(tostring(err), "\n")
	cleanup()
	os.exit(1)
end
