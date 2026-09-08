local M = { ready = false }
local plugin_path = os.getenv("HYPR_FOCUS_ANIMATION_PLUGIN")

if not plugin_path or plugin_path == "" then
	function M.configure()
		return false
	end
	return M
end

local function is_loaded()
	for _, plugin in ipairs(hl.get_loaded_plugins()) do
		if plugin.name == "focus-animation" then
			return true
		end
	end

	return false
end

local focus_animation_config = {
	leaf = "windowsFocus",
	enabled = true,
	speed = 3,
	bezier = "windowFocus",
	style = "popin 99.77%",
}

function M.configure()
	if not is_loaded() then
		return false
	end

	hl.plugin.focus_animation.prepare()
	hl.animation(focus_animation_config)
	M.ready = true
	return true
end

hl.plugin.load(plugin_path)
-- Plugin loading completes after config parsing; apply once the plugin is available.

hl.on("config.reloaded", function()
	if not M.ready then
		M.configure()
	end
end)

return M
