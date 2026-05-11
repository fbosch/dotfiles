local window = require("lib.window")

local M = {}

function M.address(window_handle)
	return window_handle and window_handle.address and "address:" .. window_handle.address or nil
end

function M.is_tiled(window_handle)
	return window_handle and not window_handle.floating
end

function M.tiled_summary(workspace)
	local count = 0
	local first = nil
	local second = nil
	local third = nil

	for _, window_handle in ipairs(workspace:get_windows()) do
		if window_handle.visible and not window_handle.floating then
			count = count + 1
			if count == 1 then
				first = window_handle
			elseif count == 2 then
				second = window_handle
			elseif count == 3 then
				third = window_handle
			elseif count > 3 then
				return count, first, second, third
			end
		end
	end

	return count, first, second, third
end

function M.dispatch_on_window(window_handle, dispatcher)
	local target = window_handle and window_handle.address and "address:" .. window_handle.address or nil
	if not target then
		return
	end

	local previous = M.address(window.active())
	if previous == target then
		hl.dispatch(dispatcher)
		return
	end

	hl.dispatch(hl.dsp.focus({ window = target }))
	hl.dispatch(dispatcher)

	if previous then
		hl.dispatch(hl.dsp.focus({ window = previous }))
	end
end

function M.defer(callback, timeout)
	if hl.timer then
		hl.timer(callback, { timeout = timeout or 100, type = "oneshot" })
		return
	end

	callback()
end

return M
