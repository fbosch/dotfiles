local monitor_role = require("lib.monitor_role")
local window_tags = require("lib.window_tags")

local M = {}

local function expected_layout(role)
	if role == monitor_role.portrait then
		return "lua:portrait_rows"
	end

	if role == monitor_role.ultrawide then
		return "lua:ultrawide_master"
	end
end

local function workspace_name(workspace)
	if workspace == nil then
		return nil
	end

	return tostring(workspace.name or workspace.id)
end

function M.active()
	if hl.get_active_window then
		return hl.get_active_window()
	end

	for _, window in ipairs(hl.get_windows()) do
		if window.active then
			return window
		end
	end
end

function M.at_cursor()
	if hl.get_cursor_pos == nil then
		return nil
	end

	local cursor = hl.get_cursor_pos()
	if cursor == nil then
		return nil
	end

	local active_workspace = hl.get_active_workspace and workspace_name(hl.get_active_workspace()) or nil
	for _, client in ipairs(hl.get_windows()) do
		local at = client.at
		local size = client.size
		if
			client.visible ~= false
			and (active_workspace == nil or workspace_name(client.workspace) == active_workspace)
			and at
			and size
			and at.x
			and at.y
			and size.x
			and size.y
			and cursor.x >= at.x
			and cursor.x < at.x + size.x
			and cursor.y >= at.y
			and cursor.y < at.y + size.y
		then
			return client
		end
	end
end

function M.is_game(window)
	return window ~= nil and window.content_type == "game"
end

function M.active_is_game()
	return M.is_game(M.active())
end

function M.active_is_not_game()
	return not M.active_is_game()
end

function M.active_is_not_tagged(expected)
	return function()
		local active = M.active()
		return window_tags.has(active and active.tags, expected) == false
	end
end

function M.uses_custom_layout(active, expected)
	local workspace = active and active.workspace
	local layout = workspace and workspace.tiled_layout
	local expected_name = expected_layout(expected)
	return layout == expected_name
end

function M.uses_any_custom_layout(active)
	return M.uses_custom_layout(active, monitor_role.portrait) or M.uses_custom_layout(active, monitor_role.ultrawide)
end

function M.active_workspace_is(workspace_name)
	return function()
		local active_workspace = hl.get_active_workspace()
		return active_workspace ~= nil and active_workspace.name == workspace_name
	end
end

function M.active_workspace_is_not(workspace_name)
	return function()
		return M.active_workspace_is(workspace_name)() == false
	end
end

return M
