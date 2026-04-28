-- Lua-native equivalent of scripts/window-switcher-wrapper.sh for Lua keybinds.
-- Keep the AGS window-switcher as the primary multi-window implementation.

local paths = require("lua.lib.paths")
local system = require("lua.lib.system")

local M = {}

local minimized_workspace_prefix = "special:minimized"
local toggle_minimized_workspace = paths.script("toggle-minimized-workspace.sh")

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

local function address(win)
	return win.address or ""
end

local function single_regular_window()
	local found = nil
	for _, win in ipairs(hl.get_windows()) do
		if not workspace_name(win):match("^special:") then
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

	if workspace_name(win):match("^" .. minimized_workspace_prefix) then
		exec(system.shell_quote(toggle_minimized_workspace) .. " " .. system.shell_quote(address(win)))
	end

	hl.dispatch(hl.dsp.focus({ window = "address:" .. address(win) }))
	return true
end

local function send_ags_action(action)
	local base = "ags request -i ags-bundled window-switcher"
	exec(base .. " " .. system.shell_quote([[{"action":"]] .. action .. [["}]]))
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
