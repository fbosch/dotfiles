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

	hl.config(profile.config)
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
	return M.apply(M.current_mode())
end

return M
