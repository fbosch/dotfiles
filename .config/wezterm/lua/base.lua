local wezterm = require("wezterm")

return function(config)
	config.front_end = "OpenGL"
	config.webgpu_power_preference = "HighPerformance"
	config.max_fps = 120
	config.animation_fps = 120
	config.enable_wayland = true
	config.audible_bell = "Disabled"
	config.status_update_interval = 10000
	config.skip_close_confirmation_for_processes_named = {
		"bash",
		"sh",
		"zsh",
		"fish",
		"tmux",
		"nu",
		"cmd.exe",
		"pwsh.exe",
		"powershell.exe",
		"wsl.exe",
		"starship",
	}
end
