local policies = require("gaming.policies")

local M = {}

local window_property_aliases = {
	xdg_tag = "xdgTag",
	content = "contentType",
}

local function matches_pattern(value, pattern)
	-- Use one selector grammar for Hyprland rules and watchdog matching.
	return value:match(pattern:gsub([=[\%.]=], "%%.")) ~= nil
end

function M.matches_selector(window, selector)
	for property, pattern in pairs(selector) do
		local value = window[property] or window[window_property_aliases[property]]
		if type(value) ~= "string" or not matches_pattern(value, pattern) then
			return false
		end
	end

	return true
end

function M.match(window)
	for _, game in ipairs(policies.games) do
		for _, selector in ipairs(game.selectors) do
			if M.matches_selector(window, selector) then
				return game, false
			end
		end

		for _, rule in ipairs(game.launcher_rules or {}) do
			if M.matches_selector(window, rule.match) then
				return game, true
			end
		end
	end

	return nil
end

function M.is_freeze_excluded(window)
	local game = M.match(window)
	return game ~= nil and game.freeze == false
end

function M.is_profile_excluded(window)
	local game, is_launcher = M.match(window)
	return game ~= nil and (is_launcher or game.exclude_profile == true)
end

function M.requires_close_confirmation(window)
	local game = M.match(window)
	return game ~= nil and game.confirm_close == true
end

function M.is_gamescope_window(window)
	return window.class == "gamescope" or window.initial_class == "gamescope"
end

function M.has_gamescope_window()
	for _, window in ipairs(hl.get_windows()) do
		if M.is_gamescope_window(window) then
			return true
		end
	end

	return false
end

return M
