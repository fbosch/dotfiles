-- Lua-native equivalent of scripts/window-switcher-wrapper.sh for Lua keybinds.
-- Keep the Bash script for legacy hyprland.conf until Lua config is release-ready.

local command = require("lua.lib.command")
local paths = require("lua.lib.paths")
local system = require("lua.lib.system")
local window = require("lua.lib.window")

local M = {}

local minimized_workspace_prefix = "special:minimized"
local toggle_minimized_workspace = paths.script("toggle-minimized-workspace.sh")

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

local function is_regular_window(win)
	return not workspace_name(win):match("^special:")
end

local function regular_windows()
	local result = {}
	for _, win in ipairs(hl.get_windows()) do
		if is_regular_window(win) then
			result[#result + 1] = win
		end
	end

	table.sort(result, function(left, right)
		local left_key = table.concat({ left.class or "", left.title or "", address(left) }, "\0")
		local right_key = table.concat({ right.class or "", right.title or "", address(right) }, "\0")
		return left_key < right_key
	end)

	return result
end

local function show_minimized_workspace_for_window(win)
	if address(win) == "" then
		return
	end

	if not workspace_name(win):match("^" .. minimized_workspace_prefix) then
		return
	end

	hl.exec_cmd(system.shell_quote(toggle_minimized_workspace) .. " " .. system.shell_quote(address(win)))
end

local function focus_window(win)
	if address(win) == "" then
		return
	end

	show_minimized_workspace_for_window(win)
	hl.dispatch(hl.dsp.focus({ window = "address:" .. address(win) }))
end

local function send_ags_action(action)
	local request = "ags request -i ags-bundled window-switcher"
	if not command.ok(request .. " '' >/dev/null 2>&1") then
		return false
	end

	hl.exec_cmd(request .. " " .. system.shell_quote([[{"action":"]] .. action .. [["}]]))
	return true
end

local function fallback_cycle(action)
	if action ~= "next" and action ~= "prev" then
		return
	end

	local windows = regular_windows()
	if #windows <= 1 then
		return
	end

	local current = window.active()
	local current_address = current and address(current) or ""
	local current_index = nil
	for index, win in ipairs(windows) do
		if address(win) == current_address then
			current_index = index
			break
		end
	end

	local step = action == "prev" and -1 or 1
	local next_index = current_index and (((current_index - 1 + step) % #windows) + 1)
		or (step > 0 and 1 or #windows)

	focus_window(windows[next_index])
end

local function switch_window(action)
	local windows = regular_windows()
	if #windows == 1 and (action == "next" or action == "prev") then
		focus_window(windows[1])
		return
	end

	if send_ags_action(action) then
		return
	end

	fallback_cycle(action)
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
