local picture_in_picture = require("actions.picture-in-picture")

local M = {}
local drag_started = false

function M.start_drag(state)
	local target = state.at_cursor() or state.active()
	if target == nil or (state.is_game(target) and target.fullscreen ~= 0) then
		return false
	end

	drag_started = true
	picture_in_picture.drag()
	return true
end

function M.finish_drag(state, layout)
	if drag_started == false then
		return false
	end

	drag_started = false
	if state.active_is_game() == false then
		layout.place_custom_layout_at_cursor(state)
	end
	picture_in_picture.finish_drag()
	return true
end

return M
