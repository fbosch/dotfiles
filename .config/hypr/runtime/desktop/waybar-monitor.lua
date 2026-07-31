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
local pip = require("lib.picture_in_picture")

local show_threshold = 20
local hide_threshold = 60
local show_delay_ms = 200
local hide_delay_ms = 300
local fast_interval_ms = 80
local slow_interval_ms = 1000
local monitor_cache_ttl_s = 10
local monitor_margin = 50
local pip_vicinity = 12
local control_socket_path = (os.getenv("XDG_RUNTIME_DIR") or "/tmp") .. "/hypr-waybar-monitor.sock"

local monitors = {}
local last_monitor_name = nil
local monitor_cache_at = 0
local waybar_visible = command.ok("pgrep -x waybar >/dev/null 2>&1")
local super_held = false
local show_started_at = nil
local hide_started_at = nil

local function now_ms()
	return math.floor(socket.gettime() * 1000)
end

local function read_file(path)
	local handle = io.open(path, "r")
	if not handle then
		return ""
	end

	local content = handle:read("*a")
	handle:close()
	return content
end

local function request(message)
	local ok, response = pcall(hypr_ipc.request, message)
	if ok then
		return response or ""
	end

	return ""
end

local function rectangle(left, top, width, height)
	return { left = tonumber(left) or 0, top = tonumber(top) or 0, width = tonumber(width) or 0, height = tonumber(height) or 0 }
end

local function overlaps(first, second)
	return first.left < second.left + second.width
		and second.left < first.left + first.width
		and first.top < second.top + second.height
		and second.top < first.top + first.height
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

local function predicted_waybar_layers()
	local config = json.object(read_file(os.getenv("HOME") .. "/.config/waybar/config"))
	local height = tonumber(config.height)
	if config.position ~= "bottom" or not height then
		return {}
	end

	local left = tonumber(config["margin-left"]) or 0
	local right = tonumber(config["margin-right"]) or 0
	local bottom = tonumber(config["margin-bottom"]) or 0
	local layers = {}
	for name, monitor in pairs(monitors) do
		layers[name] = { rectangle(monitor.x + left, monitor.y + monitor.height - height - bottom, monitor.width - left - right, height) }
	end
	return layers
end

local function visible_waybar_layers()
	local layers = json.object(request("j/layers"))
	local visible = {}
	for name, monitor in pairs(layers) do
		for _, level in pairs(monitor.levels or {}) do
			for _, layer in ipairs(level) do
				if layer.namespace == "waybar" and (tonumber(layer.alpha) or 0) > 0 then
					visible[name] = visible[name] or {}
					visible[name][#visible[name] + 1] = rectangle(layer.x, layer.y, layer.w, layer.h)
				end
			end
		end
	end
	return visible
end

local function move_pip(mode)
	refresh_monitors()
	local bars = mode == "show" and predicted_waybar_layers() or visible_waybar_layers()
	for _, window in ipairs(json.array(request("j/clients"))) do
		if window.mapped ~= false and window.hidden ~= true and window.floating == true and window.class == pip.class and window.title == pip.title then
			local monitor
			for _, candidate in pairs(monitors) do
				if candidate.id == tostring(window.monitor) then
					monitor = candidate
					break
				end
			end
			if monitor then
				local width = tonumber(window.size[1]) or 0
				local height = tonumber(window.size[2]) or 0
				local normal_x = monitor.x + monitor.width - width - pip.right_margin
				local normal_y = monitor.y + monitor.height - height - pip.bottom_margin
				local window_rect = rectangle(window.at[1], window.at[2], width, height)
				local target_y
				for _, bar in ipairs(bars[monitor.name] or {}) do
					if mode == "show" and overlaps(window_rect, bar) then
						target_y = target_y and math.min(target_y, bar.top - height - pip.overlap_gap) or bar.top - height - pip.overlap_gap
					elseif mode == "hide" then
						local avoidance_y = bar.top - height - pip.overlap_gap
						if math.abs(window_rect.left - normal_x) <= pip_vicinity and math.abs(window_rect.top - avoidance_y) <= pip_vicinity then
							target_y = normal_y
						end
					end
				end
				if target_y then
					request(string.format("dispatch hl.dsp.window.move({ x = %d, y = %d, window = %s })", normal_x, target_y, json.encode("address:" .. window.address)))
				end
			end
		end
	end
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
	move_pip("show")
	if command.ok("pkill -SIGUSR1 waybar >/dev/null 2>&1") then
		waybar_visible = true
	end
end

local function hide_waybar()
	move_pip("hide")
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
	end
	control:send("ok\n")
	control:close()
end

local function run()
	refresh_monitors()
	if waybar_visible then move_pip("show") end

	os.remove(control_socket_path)
	local server = assert(unix())
	assert(server:bind(control_socket_path))
	assert(server:listen())
	server:settimeout(0)

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

		local ready = socket.select({ server }, nil, interval / 1000)
		if #ready > 0 then
			local control = server:accept()
			if control then handle_control(control) end
		end
	end
end

local ok, err = xpcall(run, debug.traceback)
os.remove(control_socket_path)
if ok == false then error(err) end
