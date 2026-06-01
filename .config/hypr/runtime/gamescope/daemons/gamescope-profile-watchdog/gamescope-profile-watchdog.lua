#!/usr/bin/env lua

local socket = require("socket")

local home = os.getenv("HOME")
local hypr_ipc = dofile(home .. "/.config/hypr/runtime/lib/hypr-ipc.lua")
local profilectl = home .. "/.config/hypr/runtime/profiles/profilectl.sh"
local reconnect_delay_seconds = 1
local event_idle_timeout_seconds = 5
local gaming_workspace = "10"
local gaming_overlay_workspace = "special:gaming-overlay"

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function profile_sync(count)
	os.execute(shell_quote(profilectl) .. " sync gaming " .. shell_quote(count) .. " >/dev/null 2>&1")
end

local function jq(input, args, filter)
	local command = "printf %s " .. shell_quote(input) .. " | jq -r " .. (args or "") .. " " .. shell_quote(filter)
	local handle = io.popen(command, "r")
	local output = handle and handle:read("*a") or ""
	if handle then
		handle:close()
	end
	return (output:gsub("%s+$", ""))
end

local function get_clients_json()
	local ok, clients = pcall(hypr_ipc.request, "j/clients")
	if ok and clients and clients ~= "" then
		return clients
	end
	return "[]\n"
end

local function get_gaming_window_count(clients_json)
	local count = jq(clients_json or get_clients_json(), "", [[
[.[] | select((((.class // "") | ascii_downcase) | test("^(gamescope|steam_app_[0-9]+)$")) or (((.initialClass // "") | ascii_downcase) | test("^(gamescope|steam_app_[0-9]+)$")))] | length
]])
	return tonumber(count) or 0
end

local function sync_gaming_state(last_count, clients_json, force)
	local count = get_gaming_window_count(clients_json)
	if force or count ~= last_count then
		profile_sync(count)
		return count
	end
	return last_count
end

local function overlay_window_count(clients_json)
	local count = jq(clients_json or get_clients_json(), "--arg overlay " .. shell_quote(gaming_overlay_workspace), [[
[.[] | select(.workspace.name == $overlay)] | length
]])
	return tonumber(count) or 0
end

local function lua_string(value)
	return string.format("%q", value)
end

local function maybe_show_gaming_overlay(current_count, last_count, monitors_json)
	if current_count <= last_count then
		return
	end

	monitors_json = monitors_json or hypr_ipc.request("j/monitors")
	local target_monitor = jq(monitors_json, "--arg ws " .. shell_quote(gaming_workspace), [[
first(.[] | select(.activeWorkspace.name == $ws) | .name) // empty
]])
	if target_monitor == "" then
		return
	end

	local overlay_visible = jq(monitors_json, "--arg monitor " .. shell_quote(target_monitor) .. " --arg overlay " .. shell_quote(gaming_overlay_workspace), [[
first(.[] | select(.name == $monitor) | .specialWorkspace.name == $overlay) // false
]])
	if overlay_visible == "true" then
		return
	end

	hypr_ipc.request("dispatch hl.dsp.focus({ monitor = " .. lua_string(target_monitor) .. " })")
	hypr_ipc.request("dispatch hl.dsp.workspace.toggle_special(" .. lua_string(gaming_overlay_workspace:gsub("^special:", "")) .. ")")
end

local function event_kind(event)
	if event:match("^configreloaded") then
		return "reload"
	end
	if event:match("^openwindow")
		or event:match("^closewindow")
		or event:match("^movewindow")
		or event:match("^workspace")
		or event:match("^activewindow")
		or event:match("^fullscreen") then
		return "window"
	end
	return nil
end

local function cleanup()
	profile_sync(0)
end

local function run()
	local last_count = sync_gaming_state(nil, get_clients_json(), true)
	local last_overlay_count = overlay_window_count(get_clients_json())

	while true do
		local ok, err = pcall(function()
			local events = hypr_ipc.connect_event_socket({ read_timeout = event_idle_timeout_seconds })
			while true do
				local line, read_err, partial = events:receive("*l")
				line = line or partial
				local kind = line and event_kind(line) or nil
				if kind then
					local clients_json = get_clients_json()
					local current_overlay_count = overlay_window_count(clients_json)
					local monitors_json = nil
					if current_overlay_count > last_overlay_count then
						monitors_json = hypr_ipc.request("j/monitors")
					end

					maybe_show_gaming_overlay(current_overlay_count, last_overlay_count, monitors_json)
					last_overlay_count = current_overlay_count
					last_count = sync_gaming_state(last_count, clients_json, kind == "reload")
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
