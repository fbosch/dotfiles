#!/usr/bin/env luajit

local home = os.getenv("HOME")
local config_dir = home .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local socket = require("socket")
local hypr_ipc = require("runtime.lib.hypr-ipc")
local json = require("lib.json")
local target_address = ""
local delay = 0

for index = 1, #arg do
	if arg[index] == "--window" then
		target_address = arg[index + 1] or ""
	elseif arg[index] == "--delay" then
		delay = tonumber(arg[index + 1]) or 0
	end
end

if delay > 0 then
	socket.sleep(delay)
end

local target_window = nil
if target_address ~= "" then
	if target_address:match("^0x[%da-fA-F]+$") == nil then
		return
	end

	for _, window in ipairs(json.array(hypr_ipc.request("j/clients"))) do
		if window.address == target_address then
			target_window = window
			break
		end
	end
	if target_window == nil then
		return
	end

	hypr_ipc.request('dispatch hl.dsp.focus({ window = "address:' .. target_address .. '" })')
else
	target_window = json.object(hypr_ipc.request("j/activewindow"))
end

local at = target_window.at
local size = target_window.size

if type(at) ~= "table" or type(size) ~= "table" then
	return
end

local x, y = at[1], at[2]
local width, height = size[1], size[2]
if type(x) ~= "number" or type(y) ~= "number" or type(width) ~= "number" or type(height) ~= "number" then
	return
end

local cursor_x = math.floor(x + width / 2)
local cursor_y = math.floor(y + height / 2)
hypr_ipc.request(string.format("dispatch hl.dsp.cursor.move({ x = %d, y = %d })", cursor_x, cursor_y))
