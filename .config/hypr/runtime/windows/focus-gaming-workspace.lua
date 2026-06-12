#!/usr/bin/env lua

local home = os.getenv("HOME")
local config_dir = home .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local json = require("lib.json")
local hypr_ipc = dofile(config_dir .. "/runtime/lib/hypr-ipc.lua")

local gaming_workspace = "10"

local function lower(value)
	return tostring(value or ""):lower()
end

local function workspace_name(win)
	local workspace = win.workspace
	return type(workspace) == "table" and tostring(workspace.name or workspace.id or "") or tostring(workspace or "")
end

local function is_gaming_window(win)
	local app_class = lower(win.class)
	local initial_class = lower(win.initialClass or win.initial_class)

	return app_class == "gamescope"
		or initial_class == "gamescope"
		or app_class:match("^steam_app_%d+$") ~= nil
		or initial_class:match("^steam_app_%d+$") ~= nil
end

local function clients()
	local ok, body = pcall(hypr_ipc.request, "j/clients")
	if not ok or not body or body == "" then
		return {}
	end

	local decode_ok, decoded = pcall(json.decode, body)
	return decode_ok and type(decoded) == "table" and decoded or {}
end

for _, win in ipairs(clients()) do
	if workspace_name(win) == gaming_workspace and is_gaming_window(win) then
		hypr_ipc.request('dispatch hl.dsp.focus({ workspace = "' .. gaming_workspace .. '" })')
		return
	end
end
