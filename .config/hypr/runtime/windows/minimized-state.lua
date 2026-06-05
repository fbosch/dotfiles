#!/usr/bin/env lua

local home = os.getenv("HOME")
local config_dir = home .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local json = require("lib.json")
local hypr_ipc = nil

local minimized_workspace_prefix = "special:minimized"
local desktop_workspace = "special:desktop"
local gaming_workspace = "10"
local gaming_overlay_workspace = "special:gaming-overlay"
local runtime_dir = os.getenv("XDG_RUNTIME_DIR") or "/tmp"
local state_file = runtime_dir .. "/hypr-minimized-state.json"
local state_lock = runtime_dir .. "/hypr-minimized-state.lock"
local show_desktop_dir = runtime_dir .. "/hypr-show-desktop"

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function command_ok(command)
	local ok = os.execute(command .. " >/dev/null 2>&1")
	return ok == true or ok == 0
end

local function exit_from_status(ok, _, code)
	if ok == true then
		os.exit(0)
	elseif type(ok) == "number" then
		os.exit(ok)
	else
		os.exit(code or 1)
	end
end

local function run_locked()
	if os.getenv("HYPR_MINIMIZED_STATE_LOCKED") == "1" or not command_ok("command -v flock") then
		return
	end

	local command = {
		"HYPR_MINIMIZED_STATE_LOCKED=1",
		"flock",
		"-x",
		shell_quote(state_lock),
		shell_quote(arg[-1] or "lua"),
		shell_quote(arg[0]),
	}
	for index = 1, #arg do
		command[#command + 1] = shell_quote(arg[index])
	end

	exit_from_status(os.execute(table.concat(command, " ")))
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

local function write_file(path, content)
	local handle = assert(io.open(path, "w"))
	handle:write(content)
	handle:close()
end

local function temp_path_for(path)
	return path .. ".tmp." .. tostring(os.time()) .. "." .. tostring(math.random(1000000))
end

local function write_file_atomic(path, content)
	local temp = temp_path_for(path)
	write_file(temp, content)
	assert(os.rename(temp, path))
end

local function json_array(value)
	return type(value) == "table" and value or {}
end

local function json_object(value)
	if type(value) ~= "table" then
		return {}
	end

	for key in pairs(value) do
		if type(key) ~= "string" then
			return {}
		end
	end

	return value
end

local function decode_json(content, fallback)
	if not content or content == "" then
		return fallback
	end

	local ok, decoded = pcall(json.decode, content)
	if not ok then
		return fallback
	end

	return decoded
end

local function load_state()
	return json_object(decode_json(read_file(state_file), {}))
end

local function save_state(state)
	if not next(state) then
		write_file_atomic(state_file, "{}\n")
		return
	end

	write_file_atomic(state_file, json.encode(state) .. "\n")
end

local function ensure_state_file()
	local state = load_state()
	save_state(state)
	return state
end

local function request(message)
	if not hypr_ipc then
		local ok, ipc = pcall(dofile, config_dir .. "/runtime/lib/hypr-ipc.lua")
		if ok then
			hypr_ipc = ipc
		end
	end

	local ok, response = hypr_ipc and pcall(hypr_ipc.request, message)
	if ok and response and response ~= "" then
		return response
	end

	local fallback = {
		["j/activewindow"] = "hyprctl activewindow -j 2>/dev/null",
		["j/clients"] = "hyprctl clients -j 2>/dev/null",
		["j/monitors"] = "hyprctl monitors -j 2>/dev/null",
	}
	local command = fallback[message]
	if not command then
		return ""
	end

	local handle = io.popen(command, "r")
	local output = handle and handle:read("*a") or ""
	if handle then
		handle:close()
	end
	return output
end

local function query_json(message, fallback)
	return decode_json(request(message), fallback)
end

local function lua_quote(value)
	return json.encode(value)
end

local function dispatch_lua(script)
	if type(hl) == "table" and hl.dispatch then
		local chunk = load("return " .. script)
		local ok, dispatcher = chunk and pcall(chunk)
		if ok and dispatcher then
			hl.dispatch(dispatcher)
			return
		end
	end

	if not hypr_ipc then
		local load_ok, ipc = pcall(dofile, config_dir .. "/runtime/lib/hypr-ipc.lua")
		if load_ok then
			hypr_ipc = ipc
		end
	end

	local ok = hypr_ipc and pcall(hypr_ipc.request, "dispatch " .. script)
	if ok then
		return
	end

	os.execute("hyprctl dispatch " .. shell_quote(script) .. " >/dev/null 2>&1")
end

local function move_window_to_workspace(workspace, address)
	dispatch_lua("hl.dsp.window.move({ workspace = "
		.. lua_quote(workspace)
		.. ", window = "
		.. lua_quote("address:" .. address)
		.. ", follow = false })")
end

local function focus_monitor(monitor_name)
	if monitor_name and monitor_name ~= "" then
		dispatch_lua("hl.dsp.focus({ monitor = " .. lua_quote(monitor_name) .. " })")
	end
end

local function focus_window(address)
	dispatch_lua("hl.dsp.focus({ window = " .. lua_quote("address:" .. address) .. " })")
end

local function resize_window(address, width, height)
	dispatch_lua("hl.dsp.window.resize({ x = "
		.. tostring(width)
		.. ", y = "
		.. tostring(height)
		.. ", window = "
		.. lua_quote("address:" .. address)
		.. " })")
end

local function move_window(address, x, y)
	dispatch_lua("hl.dsp.window.move({ x = "
		.. tostring(x)
		.. ", y = "
		.. tostring(y)
		.. ", window = "
		.. lua_quote("address:" .. address)
		.. " })")
end

local function toggle_special_workspace(special_workspace)
	if not special_workspace or special_workspace == "" then
		return
	end

	dispatch_lua("hl.dsp.workspace.toggle_special(" .. lua_quote((special_workspace:gsub("^special:", ""))) .. ")")
end

local function bucket_key_for(monitor_name, workspace_name)
	if not monitor_name or monitor_name == "" or not workspace_name or workspace_name == "" then
		return nil
	end

	return monitor_name .. "__" .. workspace_name
end

local function special_workspace_for_bucket(bucket_key)
	if not bucket_key or bucket_key == "" then
		return minimized_workspace_prefix
	end

	local handle = io.popen("printf %s " .. shell_quote(bucket_key) .. " | sha1sum", "r")
	local hash = handle and handle:read("*l") or ""
	if handle then
		handle:close()
	end

	return minimized_workspace_prefix .. "-" .. hash:sub(1, 12)
end

local function monitor_name_for_id(monitors, monitor_id)
	for _, monitor in ipairs(json_array(monitors)) do
		if tostring(monitor.id or "") == tostring(monitor_id or "") then
			return monitor.name
		end
	end

	if monitor_id and monitor_id ~= "" then
		return "monitor-" .. tostring(monitor_id)
	end

	return ""
end

local function save_window_state(state, window, monitors)
	local address = window.address or ""
	local workspace_name = window.workspace and window.workspace.name or ""
	if address == "" or workspace_name == "" then
		return nil
	end

	local monitor_name = monitor_name_for_id(monitors, window.monitor)
	local bucket = bucket_key_for(monitor_name, workspace_name)
	local entry = {
		workspace = workspace_name,
		monitor = monitor_name,
		bucket = bucket or "",
		special = special_workspace_for_bucket(bucket),
		floating = window.floating == true,
		x = tonumber(window.at and window.at[1]) or 0,
		y = tonumber(window.at and window.at[2]) or 0,
		width = tonumber(window.size and window.size[1]) or 0,
		height = tonumber(window.size and window.size[2]) or 0,
	}

	state[address] = entry
	return entry
end

local function clear_window_state(state, address)
	if address and address ~= "" then
		state[address] = nil
	end
end

local function restore_window_state(state, address)
	local entry = state[address]
	if not entry then
		move_window_to_workspace("+0", address)
		return
	end

	if entry.workspace and entry.workspace ~= "" then
		move_window_to_workspace(entry.workspace, address)
	else
		move_window_to_workspace("+0", address)
	end

	focus_monitor(entry.monitor)
	focus_window(address)

	if entry.floating == true then
		resize_window(address, entry.width or 0, entry.height or 0)
		move_window(address, entry.x or 0, entry.y or 0)
	end

	clear_window_state(state, address)
end

local function ensure_daemon_running()
	if command_ok("pgrep -f '[m]inimized-state-daemon.sh'") then
		return
	end

	local daemon_script = config_dir .. "/runtime/windows/daemons/minimized-state/minimized-state-daemon.sh"
	if command_ok("command -v uwsm-app") then
		os.execute("uwsm-app -s b -- " .. shell_quote(daemon_script) .. " >/dev/null 2>&1 &")
	else
		os.execute(shell_quote(daemon_script) .. " >/dev/null 2>&1 &")
	end
end

local function toggle_window()
	local state = ensure_state_file()
	ensure_daemon_running()

	local active_window = query_json("j/activewindow", {})
	local address = active_window.address or ""
	local workspace = active_window.workspace and active_window.workspace.name or ""
	if address == "" then
		return
	end

	if workspace:sub(1, #minimized_workspace_prefix) == minimized_workspace_prefix then
		restore_window_state(state, address)
		save_state(state)
		return
	end

	local monitors = query_json("j/monitors", {})
	local entry = save_window_state(state, active_window, monitors)
	save_state(state)
	move_window_to_workspace((entry and entry.special) or minimized_workspace_prefix, address)
end

local function state_value_for_address(state, address, field)
	local entry = state[address]
	if type(entry) ~= "table" then
		return ""
	end

	return entry[field] or ""
end

local function bucket_has_windows(state, bucket_key)
	if not bucket_key or bucket_key == "" then
		return 0
	end

	local count = 0
	for _, entry in pairs(state) do
		if type(entry) == "table" and entry.bucket == bucket_key then
			count = count + 1
		end
	end
	return count
end

local function live_windows_in_special(special_workspace)
	if not special_workspace or special_workspace == "" then
		return 0
	end

	local count = 0
	for _, client in ipairs(json_array(query_json("j/clients", {}))) do
		if client.workspace and client.workspace.name == special_workspace then
			count = count + 1
		end
	end
	return count
end

local function monitor_for_special_workspace(state, special_workspace)
	if not special_workspace or special_workspace == "" then
		return ""
	end

	for _, entry in pairs(state) do
		if type(entry) == "table" and (entry.special or minimized_workspace_prefix) == special_workspace and entry.monitor and entry.monitor ~= "" then
			return entry.monitor
		end
	end

	return ""
end

local function visible_special_workspace(monitors)
	for _, monitor in ipairs(json_array(monitors)) do
		local special = monitor.specialWorkspace
		local name = type(special) == "table" and special.name or ""
		if name:sub(1, #minimized_workspace_prefix) == minimized_workspace_prefix then
			return name
		end
	end

	return ""
end

local function visible_special_monitor(monitors, special_workspace)
	if not special_workspace or special_workspace == "" then
		return ""
	end

	for _, monitor in ipairs(json_array(monitors)) do
		local special = monitor.specialWorkspace
		if type(special) == "table" and special.name == special_workspace then
			return monitor.name or ""
		end
	end

	return ""
end

local function toggle_special_workspace_on_monitor(monitor_name, special_workspace)
	if not special_workspace or special_workspace == "" then
		return
	end

	focus_monitor(monitor_name)
	toggle_special_workspace(special_workspace)
end

local function focused_monitor(monitors)
	for _, monitor in ipairs(json_array(monitors)) do
		if monitor.focused == true then
			return monitor
		end
	end

	return nil
end

local function target_special_from_live_client(address)
	for _, client in ipairs(json_array(query_json("j/clients", {}))) do
		local workspace = client.workspace and client.workspace.name or ""
		if client.address == address and workspace:sub(1, #minimized_workspace_prefix) == minimized_workspace_prefix then
			return workspace
		end
	end

	return ""
end

local function toggle_workspace(target_address)
	local state = ensure_state_file()
	local monitors = query_json("j/monitors", {})
	local monitor = focused_monitor(monitors)
	if not monitor then
		return
	end

	local current_monitor = monitor.name or ""
	local current_workspace = monitor.activeWorkspace and monitor.activeWorkspace.name or ""

	if (not target_address or target_address == "")
		and (current_workspace == gaming_workspace or current_workspace == gaming_overlay_workspace) then
		toggle_special_workspace_on_monitor(current_monitor, gaming_overlay_workspace)
		return
	end

	local current_bucket = ""
	local desired_special = ""
	local desired_monitor = ""
	if current_monitor ~= "" and current_workspace ~= "" and not current_workspace:match("^special:") then
		current_bucket = bucket_key_for(current_monitor, current_workspace) or ""
		desired_special = special_workspace_for_bucket(current_bucket)
		desired_monitor = current_monitor
	end

	if target_address and target_address ~= "" then
		desired_special = state_value_for_address(state, target_address, "special")
		desired_monitor = state_value_for_address(state, target_address, "monitor")

		if desired_special == "" then
			desired_special = target_special_from_live_client(target_address)
		end

		if desired_special == "" then
			desired_special = special_workspace_for_bucket(state_value_for_address(state, target_address, "bucket"))
		end

		if desired_monitor == "" then
			desired_monitor = monitor_for_special_workspace(state, desired_special)
		end
	end

	local visible_special = visible_special_workspace(monitors)
	local visible_monitor = visible_special_monitor(monitors, visible_special)
	if visible_special ~= "" then
		if desired_special ~= "" and desired_special ~= visible_special then
			if target_address and target_address ~= "" then
				toggle_special_workspace_on_monitor(visible_monitor, visible_special)
				toggle_special_workspace_on_monitor(desired_monitor, desired_special)
				return
			end

			if bucket_has_windows(state, current_bucket) ~= 0 or live_windows_in_special(desired_special) ~= 0 then
				toggle_special_workspace_on_monitor(visible_monitor, visible_special)
				toggle_special_workspace_on_monitor(desired_monitor, desired_special)
				return
			end
		end

		toggle_special_workspace_on_monitor(visible_monitor, visible_special)
		return
	end

	if target_address and target_address ~= "" then
		toggle_special_workspace_on_monitor(desired_monitor, desired_special)
		return
	end

	if current_bucket == "" or desired_special == "" then
		return
	end

	if bucket_has_windows(state, current_bucket) ~= 0 or live_windows_in_special(desired_special) ~= 0 then
		toggle_special_workspace_on_monitor(desired_monitor, desired_special)
	end
end

local function state_path_for_show_desktop(monitor_name, workspace)
	return show_desktop_dir .. "/" .. monitor_name .. "__" .. workspace
end

local function mkdir_p(path)
	os.execute("mkdir -p " .. shell_quote(path))
end

local function restore_show_desktop(state_path, current_workspace)
	local state = json_object(decode_json(read_file(state_path), {}))
	local target_workspace = state.workspace or current_workspace

	for _, window in ipairs(json_array(state.windows)) do
		if window.address and window.address ~= "" then
			move_window_to_workspace("name:" .. target_workspace, window.address)
		end
	end

	for _, window in ipairs(json_array(state.windows)) do
		if window.address and window.address ~= "" and window.floating == true then
			focus_window(window.address)
			resize_window(window.address, window.width or 0, window.height or 0)
			move_window(window.address, window.x or 0, window.y or 0)
		end
	end

	os.remove(state_path)
end

local function windows_for_show_desktop(workspace, monitor_id)
	local windows = {}
	for _, client in ipairs(json_array(query_json("j/clients", {}))) do
		local client_workspace = client.workspace and client.workspace.name or ""
		if client_workspace == workspace and tostring(client.monitor or "") == tostring(monitor_id or "") then
			windows[#windows + 1] = {
				address = client.address,
				floating = client.floating == true,
				x = tonumber(client.at and client.at[1]) or 0,
				y = tonumber(client.at and client.at[2]) or 0,
				width = tonumber(client.size and client.size[1]) or 0,
				height = tonumber(client.size and client.size[2]) or 0,
			}
		end
	end
	return windows
end

local function toggle_show_desktop()
	mkdir_p(show_desktop_dir)

	local monitor = focused_monitor(query_json("j/monitors", {}))
	if not monitor then
		return
	end

	local monitor_id = monitor.id
	local monitor_name = monitor.name or ""
	local current_workspace = monitor.activeWorkspace and monitor.activeWorkspace.name or ""
	if not monitor_id or monitor_name == "" or current_workspace == "" or current_workspace:match("^special:") then
		return
	end

	local state_path = state_path_for_show_desktop(monitor_name, current_workspace)
	if read_file(state_path) then
		restore_show_desktop(state_path, current_workspace)
		return
	end

	local windows = windows_for_show_desktop(current_workspace, monitor_id)
	if #windows == 0 then
		return
	end

	write_file_atomic(state_path, json.encode({
		monitor = monitor_name,
		workspace = current_workspace,
		windows = windows,
	}) .. "\n")

	for _, window in ipairs(windows) do
		if window.address and window.address ~= "" then
			move_window_to_workspace(desktop_workspace, window.address)
		end
	end
end

local function remove_address(address)
	if not address or address == "" then
		return
	end

	local state = ensure_state_file()
	clear_window_state(state, address)
	save_state(state)
end

local function prune()
	local state = ensure_state_file()
	local live = {}
	for _, client in ipairs(json_array(query_json("j/clients", {}))) do
		if client.address then
			live[client.address] = true
		end
	end

	for address in pairs(state) do
		if not live[address] then
			state[address] = nil
		end
	end
	save_state(state)
end

local function usage(stream)
	stream:write("usage: ", arg[0], " <toggle-window|toggle-workspace [address]|toggle-show-desktop|delete <address>|prune|init>\n")
end

math.randomseed(os.time())

local M = {
	toggle_window = toggle_window,
	toggle_workspace = toggle_workspace,
	toggle_show_desktop = toggle_show_desktop,
	delete = remove_address,
	prune = prune,
	init = ensure_state_file,
}

if not (arg and arg[0] and arg[0]:match("minimized%-state%.lua$")) then
	return M
end
local command = arg[1]
if command == "--help" or command == "help" or command == nil then
	usage(command == nil and io.stderr or io.stdout)
	os.exit(command == nil and 1 or 0)
end

run_locked()

if command == "toggle-window" then
	toggle_window()
elseif command == "toggle-workspace" then
	toggle_workspace(arg[2] or "")
elseif command == "toggle-show-desktop" then
	toggle_show_desktop()
elseif command == "delete" then
	remove_address(arg[2] or "")
elseif command == "prune" then
	prune()
elseif command == "init" then
	ensure_state_file()
else
	usage(io.stderr)
	os.exit(1)
end
