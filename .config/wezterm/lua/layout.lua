local wezterm = require("wezterm")
local mux = wezterm.mux
return function(config)
	config.window_decorations = "RESIZE|MACOS_FORCE_DISABLE_SHADOW"
	config.window_padding = {
		left = 2,
		right = 2,
		top = -1,
		bottom = 0,
	}
	-- maximize first window
	wezterm.on("gui-startup", function()
		local _, _, window = mux.spawn_window({})
		window:gui_window():maximize()
	end)
end
