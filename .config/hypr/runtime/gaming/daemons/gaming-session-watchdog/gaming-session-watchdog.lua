#!/usr/bin/env luajit

local socket = require("socket")

local home = os.getenv("HOME")
local config_dir = home .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local json = require("lib.json")
local command = require("lib.command")
local hypr_ipc = require("runtime.lib.hypr-ipc")
local gaming = require("rules.gaming")
local profilectl = home .. "/.config/hypr/runtime/profiles/profilectl.sh"
local reconnect_delay_seconds = 1
local event_idle_timeout_seconds = 5
local gaming_workspace = gaming.workspace
local minimized_workspace_prefix = "special:minimized"
local gaming_overlay_workspace = "special:gaming-overlay"
local wl_freeze_checked = false
local wl_freeze_available = false
local frozen_pids = {}
local last_presentation = nil

local function profile_sync(count)
	return command.ok(command.arg(profilectl) .. " sync gaming " .. command.arg(count) .. " >/dev/null 2>&1")
end

local function apply_presentation(presentation)
	local expression = string.format(
		'require("profiles").apply_presentation(%d, %s)',
		presentation.vrr,
		tostring(presentation.direct_scanout == 1)
	)
	return command.ok("hyprctl eval " .. command.arg(expression) .. " >/dev/null 2>&1")
end

local function get_clients()
	local ok, clients = pcall(hypr_ipc.request, "j/clients")
	if ok and clients and clients ~= "" then
		return json.array(clients)
	end
	return {}
end

local function get_monitors()
	local ok, monitors = pcall(hypr_ipc.request, "j/monitors")
	if ok and monitors and monitors ~= "" then
		return json.array(monitors)
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

local function rule_window(client)
	return {
		class = client.class,
		initial_class = client.initialClass,
		title = client.title,
		initial_title = client.initialTitle,
		content = client.contentType,
	}
end

local function has_game_content(client)
	return lower(client.contentType) == "game"
end

local function has_profile_excluded_title(client)
	return gaming.is_profile_excluded(rule_window(client))
end

local function excludes_freezing(client)
	return gaming.is_freeze_excluded(rule_window(client))
end

local function get_gaming_window_count(clients)
	local count = 0
	for _, client in ipairs(clients or get_clients()) do
		if
			not starts_with(workspace_name(client), minimized_workspace_prefix)
			and not has_profile_excluded_title(client)
			and has_game_content(client)
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
			and not excludes_freezing(client)
			and has_game_content(client)
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

	local output = command.output("ps -p " .. command.arg(pid) .. " -o state= 2>/dev/null")
	return (output:gsub("%s+", ""))
end

local function can_wl_freeze()
	if not wl_freeze_checked then
		wl_freeze_available = command.ok("command -v wl-freeze >/dev/null 2>&1")
		wl_freeze_checked = true
	end
	return wl_freeze_available
end

local function set_process_frozen(pid, should_freeze)
	if not pid or pid == "" or not can_wl_freeze() then
		return false
	end

	local state = process_state(pid)
	if state == "" then
		return false
	end

	local is_frozen = state:match("^T") ~= nil
	if is_frozen == should_freeze then
		return true
	end

	return command.ok("wl-freeze -p " .. command.arg(pid) .. " -s >/dev/null 2>&1")
end

local function sync_gaming_freeze_state(clients, monitors)
	local windows = get_freezable_gaming_windows(clients)
	monitors = monitors or get_monitors()

	local tracked_pids = {}
	local should_freeze_by_pid = {}
	for _, window in ipairs(windows) do
		tracked_pids[window.pid] = true
		local visible = workspace_visible(window.workspace, monitors)
		if should_freeze_by_pid[window.pid] == nil then
			should_freeze_by_pid[window.pid] = true
		end
		if visible then
			should_freeze_by_pid[window.pid] = false
		end
	end

	for pid in pairs(frozen_pids) do
		if not tracked_pids[pid] and set_process_frozen(pid, false) then
			frozen_pids[pid] = nil
		end
	end

	for pid, should_freeze in pairs(should_freeze_by_pid) do
		if set_process_frozen(pid, should_freeze) then
			frozen_pids[pid] = should_freeze or nil
		end
	end
end

local function sync_gaming_state(last_count, clients, force)
	local count = get_gaming_window_count(clients)
	if force or count ~= last_count then
		if profile_sync(count) then
			return count
		end
	end
	return last_count
end

local function select_presentation(clients)
	local fallback = nil
	for _, client in ipairs(clients) do
		local game, is_launcher = gaming.match(rule_window(client))
		if game ~= nil and is_launcher == false and game.presentation ~= nil then
			local presentation = {
				vrr = game.presentation.vrr or gaming.default_presentation.vrr,
				direct_scanout = game.presentation.direct_scanout or gaming.default_presentation.direct_scanout,
			}
			if client.focusHistoryID == 0 then
				return presentation
			end
			fallback = fallback or presentation
		end
	end

	return fallback or gaming.default_presentation
end

local function same_presentation(left, right)
	return left ~= nil
		and right ~= nil
		and left.vrr == right.vrr
		and left.direct_scanout == right.direct_scanout
end

local function sync_gaming_presentation(current_count, clients, force)
	if current_count == 0 then
		last_presentation = nil
		return
	end

	local presentation = select_presentation(clients)
	if force or not same_presentation(last_presentation, presentation) then
		if apply_presentation(presentation) then
			last_presentation = presentation
		end
	end
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

local function gaming_workspace_monitor(monitors)
	monitors = monitors or get_monitors()
	for _, monitor in ipairs(monitors) do
		local active_workspace = monitor.activeWorkspace
		if active_workspace and active_workspace.name == gaming_workspace then
			return monitor.name or ""
		end
	end
	return ""
end

local function toggle_gaming_overlay(monitor_name)
	if monitor_name == "" then
		return
	end

	hypr_ipc.request("dispatch hl.dsp.focus({ monitor = " .. lua_string(monitor_name) .. " })")
	hypr_ipc.request(
		"dispatch hl.dsp.workspace.toggle_special(" .. lua_string(gaming_overlay_workspace:gsub("^special:", "")) .. ")"
	)
end

local function maybe_show_gaming_overlay(current_count, last_count, monitors)
	if current_count <= last_count then
		return
	end

	monitors = monitors or get_monitors()
	local target_monitor = gaming_workspace_monitor(monitors)
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

	toggle_gaming_overlay(target_monitor)
end

local function hide_gaming_overlay_outside_workspace(monitors)
	monitors = monitors or get_monitors()
	local target_monitor = gaming_workspace_monitor(monitors)
	local focused_monitor = ""
	local hidden_overlay = false
	for _, monitor in ipairs(monitors) do
		if monitor.focused == true then
			focused_monitor = monitor.name or ""
		end

		local special_workspace = monitor.specialWorkspace
		if special_workspace and special_workspace.name == gaming_overlay_workspace then
			if monitor.name ~= target_monitor then
				toggle_gaming_overlay(monitor.name or "")
				hidden_overlay = true
			end
		end
	end

	if hidden_overlay and focused_monitor ~= "" then
		hypr_ipc.request("dispatch hl.dsp.focus({ monitor = " .. lua_string(focused_monitor) .. " })")
	end
end

local function event_kind(event)
	if event:match("^configreloaded") then
		return "reload"
	end
	if event:match("^workspace") then
		return "workspace"
	end
	if
		event:match("^openwindow")
		or event:match("^closewindow")
		or event:match("^movewindow")
		or event:match("^activespecial")
		or event:match("^activewindow")
		or event:match("^fullscreen")
	then
		return "window"
	end
	return nil
end

local function cleanup()
	for pid in pairs(frozen_pids) do
		set_process_frozen(pid, false)
	end
	profile_sync(0)
end

local function run()
	local last_count = 0
	local last_overlay_count = 0

	while true do
		local ok, err = pcall(function()
			local events = hypr_ipc.connect_event_socket({ read_timeout = event_idle_timeout_seconds })
			local clients = get_clients()
			local monitors = get_monitors()
			last_overlay_count = overlay_window_count(clients)
			hide_gaming_overlay_outside_workspace(monitors)
			sync_gaming_freeze_state(clients, monitors)
			local current_count = sync_gaming_state(last_count, clients, true)
				sync_gaming_presentation(current_count, clients, true)
			last_count = current_count

			while true do
				local line, read_err, partial = events:receive("*l")
				line = line or partial
				local kind = line and event_kind(line) or nil
				if kind then
					local clients = get_clients()
					local current_overlay_count = overlay_window_count(clients)
					local monitors = nil
					if current_overlay_count > last_overlay_count or kind == "workspace" then
						monitors = get_monitors()
					end

					maybe_show_gaming_overlay(current_overlay_count, last_overlay_count, monitors)
					if kind == "workspace" then
						hide_gaming_overlay_outside_workspace(monitors)
					end
					sync_gaming_freeze_state(clients, monitors)
					last_overlay_count = current_overlay_count
				local current_count = sync_gaming_state(last_count, clients, kind == "reload")
				sync_gaming_presentation(current_count, clients, kind == "reload")
				last_count = current_count
				end
				if read_err then
					events:close()
					break
				end
			end
		end)
		if not ok then
		io.stderr:write("gaming-session-watchdog: ", tostring(err), "\n")
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
