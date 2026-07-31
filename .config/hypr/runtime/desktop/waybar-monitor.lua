#!/usr/bin/env luajit

local socket = require("socket")
local unix = require("socket.unix")

local config_dir = os.getenv("HOME") .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local ags_ipc = require("runtime.lib.ags-ipc")
local command = require("lib.command")
local gaming = require("gaming.policies")
local hypr_ipc = require("runtime.lib.hypr-ipc")
local json = require("lib.json")

local show_threshold = 20
local hide_threshold = 60
local show_delay_ms = 200
local hide_delay_ms = 300
local fast_interval_ms = 80
local slow_interval_ms = 1000
local monitor_cache_ttl_s = 10
local monitor_margin = 50
local control_socket_path = assert(os.getenv("XDG_RUNTIME_DIR"), "XDG_RUNTIME_DIR is required") .. "/hypr-waybar-monitor.sock"
local pip_control_socket = 'nc -U "$XDG_RUNTIME_DIR/hypr-pip-monitor.sock" >/dev/null 2>&1'

local monitors = {}
local last_monitor_name = nil
local monitor_cache_at = 0
local waybar_visible = false
local super_held = false
local show_started_at = nil
local hide_started_at = nil
local control_server = nil
local owns_control_socket = false

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

local function refresh_monitors()
	if os.time() - monitor_cache_at <= monitor_cache_ttl_s and next(monitors) then
		return true
	end

	local refreshed = {}
	for _, monitor in ipairs(json.array(request("j/monitors"))) do
		local width = tonumber(monitor.width) or 0
		local height = tonumber(monitor.height) or 0
		if monitor.transform == 1 or monitor.transform == 3 then
			width, height = height, width
		end
		refreshed[monitor.name] = {
			name = monitor.name,
			id = tostring(monitor.id),
			x = tonumber(monitor.x) or 0,
			y = tonumber(monitor.y) or 0,
			width = width,
			height = height,
		}
	end

	if next(refreshed) == nil then
		return next(monitors) ~= nil
	end

	monitors = refreshed
	monitor_cache_at = os.time()
	return true
end

local function monitor_at(x, y)
	if not refresh_monitors() then
		return nil
	end

	local last = monitors[last_monitor_name]
	if last and x >= last.x and x < last.x + last.width and y >= last.y and y < last.y + last.height then
		return last
	end

	local closest = nil
	local closest_distance = math.huge
	for name, monitor in pairs(monitors) do
		if x >= monitor.x and x < monitor.x + monitor.width and y >= monitor.y and y < monitor.y + monitor.height then
			last_monitor_name = name
			return monitor
		end

		if x >= monitor.x - monitor_margin and x < monitor.x + monitor.width + monitor_margin and y >= monitor.y - monitor_margin and y < monitor.y + monitor.height + monitor_margin then
			local clamped_y = math.max(monitor.y, math.min(y, monitor.y + monitor.height - 1))
			local distance = monitor.height - (clamped_y - monitor.y)
			if distance < closest_distance then
				closest = monitor
				closest_distance = distance
				last_monitor_name = name
			end
		end
	end

	return closest
end

local function current_waybar_visibility()
	for name, monitor_layers in pairs(json.object(request("j/layers"))) do
		local monitor = monitors[name]
		if monitor then
			for _, level in pairs(monitor_layers.levels or {}) do
				for _, layer in ipairs(level) do
					local x = tonumber(layer.x) or 0
					local y = tonumber(layer.y) or 0
					local width = tonumber(layer.w) or 0
					local height = tonumber(layer.h) or 0
					if layer.namespace == "waybar"
						and (tonumber(layer.alpha) or 0) > 0
						and x < monitor.x + monitor.width
						and monitor.x < x + width
						and y < monitor.y + monitor.height
						and monitor.y < y + height
					then
						return true
					end
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
	return command.output("busctl --user call org.erikreider.swaync.cc /org/erikreider/swaync/cc org.erikreider.swaync.cc GetVisibility 2>/dev/null"):match("b true") ~= nil
end

local function show_waybar()
	command.ok("printf 'waybar-show\\n' | " .. pip_control_socket)
	if command.ok("pkill -SIGUSR1 waybar >/dev/null 2>&1") then
		waybar_visible = true
	end
end

local function hide_waybar()
	command.ok("printf 'waybar-hide\\n' | " .. pip_control_socket)
	if command.ok("pkill -SIGUSR2 waybar >/dev/null 2>&1") then
		waybar_visible = false
	end
end

local function handle_control(control)
	control:settimeout(0.05)
	local message = control:receive("*l")
	if message == "show" then
		show_waybar()
	elseif message == "hold" then
		super_held = true
		show_waybar()
	elseif message == "release" then
		super_held = false
	elseif message == "hide" then
		hide_waybar()
	elseif message == "ping" then
		-- Side-effect-free health check for the launcher.
	elseif message == "quit" then
		control:send("ok\n")
		control:close()
		return true
	end
	control:send("ok\n")
	control:close()
	return false
end

local function cleanup_control_socket()
	if control_server then
		control_server:close()
		control_server = nil
	end

	if owns_control_socket then
		os.remove(control_socket_path)
		owns_control_socket = false
	end
end

local function run()
	refresh_monitors()
	waybar_visible = current_waybar_visibility()
	command.ok("printf 'waybar-" .. (waybar_visible and "show" or "hide") .. "\\n' | " .. pip_control_socket)

	control_server = assert(unix())
	assert(control_server:bind(control_socket_path))
	assert(control_server:listen())
	owns_control_socket = true
	control_server:settimeout(0)

	while true do
		local x, y = request("cursorpos"):match("^%s*([^,]+),%s*(.+)%s*$")
		local monitor = x and y and monitor_at(tonumber(x), tonumber(y))
		local interval = 300
		if monitor then
			local distance = monitor.height - (tonumber(y) - monitor.y)
			local now = now_ms()
			if waybar_visible == false then
				if distance <= show_threshold then
					show_started_at = show_started_at or now
					interval = fast_interval_ms
					if now - show_started_at >= show_delay_ms and json.object(request("j/activeworkspace")).name ~= gaming.workspace then
						show_waybar()
						show_started_at, hide_started_at = nil, nil
					end
				else
					show_started_at = nil
					interval = distance <= hide_threshold + 50 and fast_interval_ms or slow_interval_ms
				end
			elseif super_held then
				hide_started_at = nil
				interval = slow_interval_ms
			else
				interval = (distance <= hide_threshold or hide_started_at) and fast_interval_ms or slow_interval_ms
				if distance > hide_threshold then
					hide_started_at = hide_started_at or now
					if now - hide_started_at >= hide_delay_ms then
						if not taskbar_visible() and not swaync_visible() then hide_waybar() end
						hide_started_at = nil
					end
				else
					hide_started_at = nil
				end
			end
		end

		local ready = socket.select({ control_server }, nil, interval / 1000)
		if #ready > 0 then
			local control = control_server:accept()
			if control and handle_control(control) then return end
		end
	end
end

local ok, err = xpcall(run, debug.traceback)
cleanup_control_socket()
if ok == false then
	log(err)
	os.exit(1)
end
