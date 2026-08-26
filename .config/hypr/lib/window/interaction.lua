local picture_in_picture = require("actions.picture-in-picture")
local state = require("lib.window.state")

local M = {}
local drag_started = false

function M.start_drag()
	local target = state.at_cursor() or state.active()
	if target == nil or (state.is_game(target) and target.fullscreen ~= 0) then
		return false
	end

	drag_started = true
	picture_in_picture.drag(target)
	return true
end

function M.finish_drag(layout)
	if drag_started == false then
		return false
	end

	drag_started = false
	if state.active_is_game() == false then
		layout.place_custom_layout_at_cursor()
	end
	picture_in_picture.finish_drag()
	return true
end

return M
