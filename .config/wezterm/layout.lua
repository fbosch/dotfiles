local wezterm = require("wezterm")
local mux = wezterm.mux
local is_macos = wezterm.target_triple:find("darwin") ~= nil
local is_hyprland = wezterm.target_triple:find("linux") ~= nil and os.getenv("HYPRLAND_INSTANCE_SIGNATURE") ~= nil

return function(config)
	config.window_decorations = "RESIZE|MACOS_FORCE_DISABLE_SHADOW"
	config.window_padding = {
		left = 2,
		right = 2,
		top = -1,
		bottom = 0,
	}
	if is_hyprland then
		config.window_padding = {
			left = 4,
			right = 4,
			top = 4,
			bottom = 4,
		}
	end
	if is_macos then
		-- maximize first window
		wezterm.on("gui-startup", function(cmd)
			local _, _, window = mux.spawn_window(cmd or {})
			window:gui_window():maximize()
		end)
	end
end
