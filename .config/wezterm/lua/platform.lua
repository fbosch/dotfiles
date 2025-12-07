local wezterm = require("wezterm")
local is_windows = package.config:sub(0, 1) == "\\"
local is_linux = wezterm.target_triple:find("linux") ~= nil

-- Detect if running in VirtualBox
local function is_virtualbox()
	if is_windows then
		return false
	end
	
	-- Check DMI product name
	local f = io.open("/sys/class/dmi/id/product_name", "r")
	if f then
		local product = f:read("*all")
		f:close()
		if product:match("VirtualBox") then
			return true
		end
	end
	
	-- Check for VirtualBox kernel modules
	f = io.open("/proc/modules", "r")
	if f then
		local modules = f:read("*all")
		f:close()
		if modules:match("vboxguest") or modules:match("vboxvideo") then
			return true
		end
	end
	
	return false
end

return function(config)
	if is_windows then
		config.default_domain = "WSL:Ubuntu"
		config.window_decorations = "TITLE | RESIZE"
		config.font_size = 12
	elseif is_virtualbox() then
		-- VirtualBox-specific settings
		config.font_size = 12
		config.window_background_opacity = 1.0  -- Disable transparency for performance
		config.window_decorations = "NONE"
		
		-- Performance optimizations for VirtualBox
		config.front_end = "OpenGL"  -- More reliable than WebGpu on VMs
		config.max_fps = 60  -- Lower FPS for better performance
		config.animation_fps = 30  -- Reduce animation overhead
		config.cursor_blink_rate = 0  -- Disable cursor blinking
	elseif is_linux then
		-- Other Linux systems
		config.font_size = 12
		config.window_background_opacity = 0.96
		config.window_decorations = "NONE"
	else
		-- macOS and other platforms
		config.window_background_opacity = 0.96
		config.macos_window_background_blur = 80
	end
end
