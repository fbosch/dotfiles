-- Routes pointer drag/resize presses to the owning adapter and returns the
-- release callback consumed by lib.mouse_release. Hyprland still owns when
-- that callback runs.

local M = {}

function M.new(opts)
	opts = opts or {}
	local interaction = opts.interaction or require("lib.window.interaction")
	local picture_in_picture = opts.picture_in_picture or require("actions.picture-in-picture")
	local custom_layout = opts.custom_layout or require("lib.window.custom_layout")
	local state = opts.state or require("lib.window.state")
	local dispatch = opts.dispatch or hl.dispatch
	local window = opts.window or hl.dsp.window

	local router = {}

	function router.start_drag()
		if interaction.start_drag() ~= true then
			return nil
		end

		return function()
			dispatch(window.drag())
			interaction.finish_drag(custom_layout)
		end
	end

	function router.start_resize(keep_aspect_ratio)
		local target = state.at_cursor() or state.active()
		if picture_in_picture.start_resize(target, keep_aspect_ratio) then
			return function()
				dispatch(window.resize())
				picture_in_picture.finish_resize(keep_aspect_ratio)
			end
		end

		if keep_aspect_ratio then
			custom_layout.resize_keep_aspect_ratio()
			return function()
				dispatch(window.resize())
				custom_layout.reset_keep_aspect_ratio()
			end
		end

		if custom_layout.start_custom_layout_resize() then
			return custom_layout.stop_custom_layout_resize
		end

		dispatch(window.resize())
		return function()
			dispatch(window.resize())
		end
	end

	return router
end

return M
