-- Owns pointer target identity, adapter selection, native interaction dispatch,
-- and release-time revalidation. Hyprland still owns when release callbacks run.

local M = {}

local function target_identity(window)
	local stable_id = window and (window.stable_id or window.stableId)
	if stable_id ~= nil then
		return { kind = "stable", value = tostring(stable_id) }
	end

	if window and window.address then
		return { kind = "address", value = tostring(window.address) }
	end
end

local function has_identity(window, identity)
	if identity.kind == "stable" then
		local stable_id = window.stable_id or window.stableId
		return stable_id ~= nil and tostring(stable_id) == identity.value
	end

	return window.address ~= nil and tostring(window.address) == identity.value
end

function M.new(opts)
	opts = opts or {}
	local picture_in_picture = opts.picture_in_picture or require("actions.picture-in-picture")
	local custom_layout = opts.custom_layout or require("lib.window.custom_layout")
	local state = opts.state or require("lib.window.state")
	local dispatch = opts.dispatch or hl.dispatch
	local get_windows = opts.get_windows or hl.get_windows
	local window = opts.window or hl.dsp.window

	local router = {}

	local function capture_target()
		local target = state.at_cursor() or state.active()
		local identity = target_identity(target)
		if identity == nil then
			return nil
		end

		return { identity = identity, window = target }
	end

	local function revalidate(target)
		for _, current in ipairs(get_windows()) do
			if has_identity(current, target.identity) then
				return current
			end
		end
	end

	local function release_callback(target, dispatcher, finish)
		return function()
			if dispatcher then
				dispatch(dispatcher)
			end
			if finish then
				finish(revalidate(target))
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

		return release_callback(target, dispatcher, function(current)
			if current == nil or (state.is_game(current) and current.fullscreen ~= 0) then
				return
			end
			custom_layout.place_custom_layout_at_cursor(current)
		end)
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
