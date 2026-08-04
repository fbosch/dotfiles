local M = {}
local dispatch = hl.dispatch
local hypr_ipc = require("runtime.lib.hypr-ipc")
local control_protocol = require("runtime.windows.daemons.custom-layout-drag-resize.control-protocol")
local custom_layout_resize_command =
	"~/.config/hypr/runtime/windows/daemons/custom-layout-drag-resize/custom-layout-drag-resize.sh"
local custom_layout_resize_sequence_file = hypr_ipc.instance_path("custom-layout-drag-resize.sequence")

local function custom_layout_resize(action)
	local sequence = control_protocol.next_sequence(custom_layout_resize_sequence_file)
	return hl.dsp.exec_cmd(string.format("%s %s %d", custom_layout_resize_command, action, sequence))
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
