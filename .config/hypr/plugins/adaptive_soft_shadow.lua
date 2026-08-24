local plugin_path = "/run/current-system/sw/lib/libadaptive-soft-shadow.so"

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
			blend_mode = "multiply",
			color = "rgba(33333366)",
			enabled = true,
			range = 40,
			render_power = 4,
			offset = "1 1",
			strength = 0.7,
		},
	},
})
