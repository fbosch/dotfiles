local interaction = require("lib.window.interaction")
local layout = require("lib.window.layout")
local navigation = require("lib.window.navigation")
local state = require("lib.window.state")
local workspace = require("lib.window.workspace")

local M = {
	active = state.active,
	at_cursor = state.at_cursor,
	active_workspace_is = state.active_workspace_is,
	active_workspace_is_not = state.active_workspace_is_not,
	is_game = state.is_game,
	active_is_game = state.active_is_game,
	active_is_not_game = state.active_is_not_game,
	uses_any_custom_layout = state.uses_any_custom_layout,
	focus_workspace = workspace.focus_workspace,
	move_to_workspace = workspace.move_to_workspace,
	move_to_gaming_workspace = workspace.move_to_gaming_workspace,
	hide_from_current_workspace = workspace.hide_from_current_workspace,
	start_custom_layout_resize = layout.start_custom_layout_resize,
	stop_custom_layout_resize = layout.stop_custom_layout_resize,
	resize_keep_aspect_ratio = layout.resize_keep_aspect_ratio,
	reset_keep_aspect_ratio = layout.reset_keep_aspect_ratio,
}

function M.focus_gaming_workspace()
	return workspace.focus_gaming_workspace(state)
end

function M.start_drag()
	return interaction.start_drag(state)
end

function M.finish_drag()
	return interaction.finish_drag(state, layout)
end

function M.place_custom_layout_at_cursor()
	return layout.place_custom_layout_at_cursor(state)
end

function M.focus(value)
	return navigation.focus(state, value)
end

function M.move(value)
	return navigation.move(state, value)
end

function M.adjust(kind, value)
	return navigation.adjust(state, kind, value)
end

return M
