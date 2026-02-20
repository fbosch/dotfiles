local wezterm = require("wezterm")
local gpus -- Lazy load GPUs only once

return function(config)
	if not gpus then
		gpus = wezterm.gui.enumerate_gpus()
	end

	config.front_end = "OpenGL"
	config.webgpu_power_preference = "HighPerformance"
	-- config.webgpu_preferred_adapter = gpus[1]
	config.max_fps = 165
	config.animation_fps = 60
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
