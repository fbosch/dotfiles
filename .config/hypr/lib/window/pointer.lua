-- Owns pointer target identity, adapter selection, native interaction dispatch,
-- and release-time revalidation. Hyprland still owns when release callbacks run.

local M = {}

function M.new(opts)
	opts = opts or {}
	local picture_in_picture = opts.picture_in_picture or require("actions.picture-in-picture")
	local custom_layout = opts.custom_layout or require("lib.window.custom_layout")
	local state = opts.state or require("lib.window.state")
	local target_adapter = opts.target_adapter or require("plugins.window_interaction_hooks")
	local dispatch = opts.dispatch or hl.dispatch
	local window = opts.window or hl.dsp.window

	local router = {}

	local function capture_target()
		if not target_adapter.enabled then
			return nil
		end

		local target = target_adapter.capture_at_cursor()
		if target then
			return target
		end
		return target_adapter.capture_window(state.active())
	end

	local function release_callback(target, dispatcher, finish)
		return function()
			if dispatcher then
				dispatch(dispatcher)
			end
			if finish then
				finish(target:resolve())
			end
		end
	end

	local function interactive_resize(keep_aspect_ratio)
		if keep_aspect_ratio then
			return window.resize({ keep_aspect_ratio = true })
		end
		return window.resize()
	end

	function router.start_drag()
		local target = capture_target()
		if target == nil or (state.is_game(target.window) and target.window.fullscreen ~= 0) then
			return nil
		end

		local pip_owned = picture_in_picture.start_drag(target.window)
		local dispatcher = window.drag()
		dispatch(dispatcher)

		if pip_owned then
			return release_callback(target, dispatcher, picture_in_picture.finish_drag)
		end

		return release_callback(target, dispatcher)
	end

	function router.start_resize(keep_aspect_ratio)
		local target = capture_target()
		if target == nil then
			return nil
		end

		if picture_in_picture.start_resize(target.window) then
			local dispatcher = interactive_resize(keep_aspect_ratio)
			dispatch(dispatcher)
			return release_callback(target, dispatcher, picture_in_picture.finish_resize)
		end

		if keep_aspect_ratio == false and custom_layout.start_custom_layout_resize(target.window) then
			return custom_layout.stop_custom_layout_resize
		end

		local dispatcher = interactive_resize(keep_aspect_ratio)
		dispatch(dispatcher)
		return release_callback(target, dispatcher)
	end

	return router
end

return M
