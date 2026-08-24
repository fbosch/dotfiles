local M = {}
local profile_state = require("lib.profile_state")

local profiles = {
	default = require("profiles.default"),
	powersave = require("profiles.powersave"),
	gaming = require("profiles.gaming"),
}

local function valid_mode(mode)
	return profiles[mode] ~= nil
end

local function is_plugin_loaded(name)
	for _, plugin in ipairs(hl.get_loaded_plugins()) do
		if plugin.name == name then
			return true
		end
	end

	return false
end

local function applicable_config(profile)
	local plugin_config = profile.config.plugin
	if is_plugin_loaded("adaptive-soft-shadow") or not plugin_config or not plugin_config.adaptive_soft_shadow then
		return profile.config
	end

	local config = {}
	for key, value in pairs(profile.config) do
		if key ~= "plugin" then
			config[key] = value
		end
	end

	local plugins = {}
	for name, value in pairs(plugin_config) do
		if name ~= "adaptive_soft_shadow" then
			plugins[name] = value
		end
	end
	if next(plugins) then
		config.plugin = plugins
	end

	local decoration = {}
	for key, value in pairs(config.decoration or {}) do
		decoration[key] = value
	end

	local shadow = {}
	for key, value in pairs(decoration.shadow or {}) do
		shadow[key] = value
	end
	shadow.enabled = plugin_config.adaptive_soft_shadow.enabled
	decoration.shadow = shadow
	config.decoration = decoration

	return config
end

function M.current_mode()
	local ok, mode = pcall(profile_state.resolved)
	if ok then
		return mode
	end

	return nil
end

function M.is_current_mode(mode)
	return valid_mode(mode) and M.current_mode() == mode
end

function M.is_gaming_active()
	return M.is_current_mode("gaming")
end

function M.apply(mode)
	local profile = profiles[mode]
	if not profile then
		return false
	end

	if profile.on_apply then
		profile.on_apply()
	end

	hl.config(applicable_config(profile))
	return true
end

function M.apply_presentation(vrr, direct_scanout)
	hl.config({
		misc = { vrr = vrr },
		render = { direct_scanout = direct_scanout },
	})
	return true
end

function M.apply_current()
	return M.apply(M.current_mode() or "default")
end

return M
