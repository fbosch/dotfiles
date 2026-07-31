#!/usr/bin/env luajit

local config_dir = os.getenv("HOME") .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local json = require("lib.json")
local pip = require("lib.picture_in_picture")
local hypr_ipc = require("runtime.lib.hypr-ipc")

local vicinity = 12

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
	return {
		left = tonumber(left) or 0,
		top = tonumber(top) or 0,
		width = tonumber(width) or 0,
		height = tonumber(height) or 0,
	}
end

local function overlaps(first, second)
	return first.left < second.left + second.width
		and second.left < first.left + first.width
		and first.top < second.top + second.height
		and second.top < first.top + first.height
end

local function monitors_by_id(monitors)
	local indexed = {}
	for _, monitor in ipairs(monitors) do
		indexed[tostring(monitor.id)] = monitor
	end

	return indexed
end

local function waybar_layers(layers, monitor_name)
	local monitor = layers[monitor_name] or {}
	local visible = {}
	for _, level in pairs(monitor.levels or {}) do
		for _, layer in ipairs(level) do
			if layer.namespace == "waybar" and (tonumber(layer.alpha) or 0) > 0 then
				visible[#visible + 1] = rectangle(layer.x, layer.y, layer.w, layer.h)
			end
		end
	end

	return visible
end

local function predicted_waybar_layers(monitors)
	local config = json.object(read_file(os.getenv("HOME") .. "/.config/waybar/config"))
	local height = tonumber(config.height)
	if config.position ~= "bottom" or not height then
		return {}
	end

	local margin_left = tonumber(config["margin-left"]) or 0
	local margin_right = tonumber(config["margin-right"]) or 0
	local margin_bottom = tonumber(config["margin-bottom"]) or 0
	local predicted = {}

	for _, monitor in ipairs(monitors) do
		local width = tonumber(monitor.width) or 0
		local monitor_height = tonumber(monitor.height) or 0
		if monitor.transform == 1 or monitor.transform == 3 then
			width, monitor_height = monitor_height, width
		end

		predicted[monitor.name] = {
			rectangle(
				(tonumber(monitor.x) or 0) + margin_left,
				(tonumber(monitor.y) or 0) + monitor_height - height - margin_bottom,
				width - margin_left - margin_right,
				height
			),
		}
	end

	return predicted
end

local function normal_position(window, monitor)
	return (tonumber(monitor.x) or 0) + (tonumber(monitor.width) or 0) - (tonumber(window.size[1]) or 0) - pip.right_margin,
		(tonumber(monitor.y) or 0) + (tonumber(monitor.height) or 0) - (tonumber(window.size[2]) or 0) - pip.bottom_margin
end

local function avoidance_position(window, normal_x, layers)
	local top = nil
	for _, layer in ipairs(layers) do
		top = top and math.min(top, layer.top) or layer.top
	end

	if not top then
		return nil
	end

	return normal_x, top - (tonumber(window.size[2]) or 0) - pip.overlap_gap
end

local function move_window(window, x, y)
	if (tonumber(window.at[1]) or 0) == x and (tonumber(window.at[2]) or 0) == y then
		return
	end

	request(string.format(
		"dispatch hl.dsp.window.move({ x = %d, y = %d, window = %s })",
		x,
		y,
		json.encode("address:" .. window.address)
	))
end

local function is_near(window, x, y)
	return x
		and y
		and math.abs((tonumber(window.at[1]) or 0) - x) <= vicinity
		and math.abs((tonumber(window.at[2]) or 0) - y) <= vicinity
end

local function position(mode)
	local clients = json.array(request("j/clients"))
	local monitor_list = json.array(request("j/monitors"))
	local monitors = monitors_by_id(monitor_list)
	local layers = mode == "hide" and json.object(request("j/layers")) or {}
	local predicted_layers = mode == "show" and predicted_waybar_layers(monitor_list) or {}

	for _, window in ipairs(clients) do
		if window.mapped ~= false
			and window.hidden ~= true
			and window.floating == true
			and window.class == pip.class
			and window.title == pip.title
		then
			local monitor = monitors[tostring(window.monitor)]
			if monitor then
				local normal_x, normal_y = normal_position(window, monitor)
				local bars = mode == "show" and predicted_layers[monitor.name] or waybar_layers(layers, monitor.name)
				local avoidance_x, avoidance_y = avoidance_position(window, normal_x, bars)

				if mode == "show" then
					local window_rectangle = rectangle(window.at[1], window.at[2], window.size[1], window.size[2])
					for _, bar in ipairs(bars) do
						if overlaps(window_rectangle, bar) then
							move_window(window, avoidance_x, avoidance_y)
							break
						end
					end
				elseif mode == "hide" and is_near(window, avoidance_x, avoidance_y) then
					move_window(window, normal_x, normal_y)
				end
			end
		end
	end
end

if arg[1] ~= "show" and arg[1] ~= "hide" then
	io.stderr:write("usage: ", arg[0], " show|hide\n")
	os.exit(1)
end

position(arg[1])
