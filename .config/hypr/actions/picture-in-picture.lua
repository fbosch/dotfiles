local pip = require("lib.picture_in_picture")

local M = {}

local control_socket = 'nc -U "$XDG_RUNTIME_DIR/hypr-pip-monitor.sock" >/dev/null 2>&1'
local dragging = false
local resizing = false

local function notify(event)
	hl.dispatch(hl.dsp.exec_cmd("printf '" .. event .. "\\n' | " .. control_socket))
end

local function active_pip()
	local active = hl.get_active_window and hl.get_active_window()
	if active and active.class == pip.class and active.title == pip.title and active.address then
		return active
	end
end

function M.drag()
	local active = active_pip()
	if active then
		dragging = true
		notify("drag-start")
	else
		notify("drag-cancel")
	end

	hl.dispatch(hl.dsp.window.drag())
end

function M.finish_drag()
	if dragging then
		notify("drag-end")
	else
		notify("drag-cancel")
	end

	dragging = false
end

function M.start_resize(keep_aspect_ratio)
	if not active_pip() then
		return false
	end

	resizing = true
	notify("resize-start")
	if keep_aspect_ratio then
		hl.dispatch(hl.dsp.window.set_prop({ prop = "keep_aspect_ratio", value = "1" }))
	end
	hl.dispatch(hl.dsp.window.resize())
	return true
end

function M.finish_resize(keep_aspect_ratio)
	if resizing == false then
		return false
	end

	if keep_aspect_ratio then
		hl.dispatch(hl.dsp.window.set_prop({ prop = "keep_aspect_ratio", value = "0" }))
	end
	notify("resize-end")
	resizing = false
	return true
end

return M
