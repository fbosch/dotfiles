local plugin_path = os.getenv("HYPR_ADAPTIVE_SOFT_SHADOW_PLUGIN")
	or "/run/current-system/sw/lib/libadaptive-soft-shadow.so"

local function is_loaded()
	for _, plugin in ipairs(hl.get_loaded_plugins()) do
		if plugin.name == "adaptive-soft-shadow" then
			return true
		end
	end

	return false
end

hl.plugin.load(plugin_path)

if not is_loaded() then
	-- Plugin loading schedules a reload; this parse still uses the old config schema.
	return
end

hl.config({
	plugin = {
		adaptive_soft_shadow = {
			enabled = true,
			range = 20,
			render_power = 4,
			offset = "1 1",
			strength = 0.5,
		},
	},
})
