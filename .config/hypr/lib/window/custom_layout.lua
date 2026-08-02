local M = {}
local dispatch = hl.dispatch
local custom_layout_resize_command =
	"~/.config/hypr/runtime/windows/daemons/custom-layout-drag-resize/custom-layout-drag-resize.sh"

local function custom_layout_resize(action)
	return hl.dsp.exec_cmd(custom_layout_resize_command .. " " .. action)
end

function M.place_custom_layout_at_cursor(state)
	if state.uses_any_custom_layout(state.active()) then
		dispatch(hl.dsp.layout("place-at-cursor"))
	end
end

function M.start_custom_layout_resize()
	M.reset_keep_aspect_ratio()
	dispatch(custom_layout_resize("start"))
end

function M.stop_custom_layout_resize()
	dispatch(custom_layout_resize("stop"))
end

function M.resize_keep_aspect_ratio()
	dispatch(custom_layout_resize("stop"))
	dispatch(hl.dsp.window.set_prop({ prop = "keep_aspect_ratio", value = "1" }))
	dispatch(hl.dsp.window.resize())
end

function M.reset_keep_aspect_ratio()
	dispatch(hl.dsp.window.set_prop({ prop = "keep_aspect_ratio", value = "0" }))
end

return M
