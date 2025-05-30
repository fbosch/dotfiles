local is_windows = package.config:sub(0, 1) == "\\"

return function(config)
	if is_windows then
		config.default_domain = "WSL:Ubuntu"
		config.window_decorations = "TITLE | RESIZE"
		config.font_size = 12
	else
		config.window_background_opacity = 0.98
		config.macos_window_background_blur = 50
	end
end
