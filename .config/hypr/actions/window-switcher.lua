-- Lua-native equivalent of scripts/window-switcher-wrapper.sh for Lua keybinds.
-- Keep the AGS window-switcher as the primary multi-window implementation.

local ags = require("lib.ags")
local command = require("lib.command")
local paths = require("lib.paths")

local M = {}

local minimized_workspace_prefix = "special:minimized"
local toggle_minimized_workspace = paths.runtime_script("windows/toggle-minimized-workspace.sh")
local action_payloads = {}

local function exec(command)
	hl.exec_cmd(command)
end

local function workspace_name(win)
	local workspace = win.workspace
	if type(workspace) == "table" then
		return workspace.name or (workspace.id and tostring(workspace.id)) or ""
	end

	return tostring(workspace or "")
end

local function regular_window(win)
	local workspace = win.workspace
	if type(workspace) == "table" then
		local name = workspace.name
		if name then
			return not name:match("^special:")
		end

		return true
	end

	return not tostring(workspace or ""):match("^special:")
end

local function address(win)
	return win.address or ""
end

local function single_regular_window()
	local found = nil
	for _, win in ipairs(hl.get_windows()) do
		if regular_window(win) then
			if found then
				return nil
			end

			found = win
		end
	end

	return found
end

local function focus_window(win)
	if not win or address(win) == "" then
		return false
	end

	local minimized = workspace_name(win):match("^" .. minimized_workspace_prefix)
	if minimized then
		exec(command.line(toggle_minimized_workspace, address(win)))
	end

	if win.active and not minimized then
		return true
	end

	local active = hl.get_active_window and hl.get_active_window()
	if active and active.address == win.address and not minimized then
		return true
	end

	hl.dispatch(hl.dsp.focus({ window = "address:" .. address(win) }))
	return true
end

local function send_ags_action(action)
	action_payloads[action] = action_payloads[action] or { action = action }
	ags.request("window-switcher", action_payloads[action])
end

local function switch_window(action)
	if action == "next" or action == "prev" then
		local single = single_regular_window()
		if single and focus_window(single) then
			return
		end
	end

	send_ags_action(action)
end

function M.next()
	switch_window("next")
end

function M.prev()
	switch_window("prev")
end

function M.commit()
	switch_window("commit")
end

function M.hide()
	switch_window("hide")
end

return M
