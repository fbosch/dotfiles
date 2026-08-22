local M = {}

function M.register()
	hl.on("window.open", function(window)
		if not window or window.floating == true or window.fullscreen_client ~= 1 then
			return
		end

		-- Hyprland 0.56 preserves pre-map client maximize requests. Tiled
		-- geometry is compositor-owned, so restore the initial windowed state.
		hl.dispatch(hl.dsp.window.fullscreen_state({
			internal = 0,
			client = 0,
			window = window,
		}))
	end)
end

return M
