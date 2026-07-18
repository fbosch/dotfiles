#!/usr/bin/env lua

local home = os.getenv("HOME")
local config_dir = home .. "/.config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local json = require("lib.json")
local hypr_ipc = require("runtime.lib.hypr-ipc")

local gaming_workspace = "10"

local function workspace_name(win)
	local workspace = win.workspace
	return type(workspace) == "table" and tostring(workspace.name or workspace.id or "") or tostring(workspace or "")
end

local function clients()
	local ok, body = pcall(hypr_ipc.request, "j/clients")
	if not ok or not body or body == "" then
		return {}
	end

	return json.array(body)
end

for _, win in ipairs(clients()) do
	if workspace_name(win) == gaming_workspace then
		hypr_ipc.request('dispatch hl.dsp.focus({ workspace = "' .. gaming_workspace .. '" })')
		return
	end
end
