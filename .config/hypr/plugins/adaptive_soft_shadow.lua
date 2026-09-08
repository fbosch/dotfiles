local plugin_path = os.getenv("HYPR_ADAPTIVE_SOFT_SHADOW_PLUGIN")

if not plugin_path then
	return
end

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

---@type AdaptiveSoftShadowConfig
local adaptive_soft_shadow_config = {
	blend_mode = "soft-light",
	color = "rgba(00000033)",
	enabled = true,
	range = 40,
	render_power = 4,
	offset = "0 2",
	-- strength = 0.3,
	active_strength = 0.8,
	inactive_strength = 0.3,
}

hl.config({
	plugin = {
		adaptive_soft_shadow = adaptive_soft_shadow_config,
	},
})
