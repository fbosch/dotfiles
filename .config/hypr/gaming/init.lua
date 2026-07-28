local matcher = require("gaming.matcher")
local policies = require("gaming.policies")
local rules = require("gaming.rules")
local events = require("gaming.events")

local M = {
	workspace = policies.workspace,
	default_presentation = policies.default_presentation,
	games = policies.games,
	matches_selector = matcher.matches_selector,
	match = matcher.match,
	is_freeze_excluded = matcher.is_freeze_excluded,
	is_profile_excluded = matcher.is_profile_excluded,
	requires_close_confirmation = matcher.requires_close_confirmation,
	is_gamescope_window = matcher.is_gamescope_window,
	has_gamescope_window = matcher.has_gamescope_window,
}

function M.register_window_rules()
	rules.register()
	events.register()
end

return M
