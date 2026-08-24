local M = { ready = false }
local plugin_path = os.getenv("HYPR_FOCUS_ANIMATION_PLUGIN")

if not plugin_path then
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

hl.plugin.load(plugin_path)

if not is_loaded() then
	-- Plugin loading schedules a reload; configure the leaf on the next parse.
	return M
end

hl.plugin.focus_animation.prepare()
M.ready = true

return M
