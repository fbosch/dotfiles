local policies = require("gaming.policies")

local M = {}

local function collection_negative_match(property)
	local patterns = {}
	local seen = {}

	local function collect(selector)
		local pattern = selector[property]
		if type(pattern) == "string" and not seen[pattern] then
			seen[pattern] = true
			patterns[#patterns + 1] = pattern
		end
	end

	for _, game in ipairs(policies.games) do
		for _, selector in ipairs(game.selectors) do
			collect(selector)
		end

		for _, rule in ipairs(game.launcher_rules or {}) do
			collect(rule.match)
		end
	end

	return "negative:(" .. table.concat(patterns, "|") .. ")"
end

local collection_class_exclusion = collection_negative_match("class")
local collection_initial_title_exclusion = collection_negative_match("initial_title")

local function gaming_window_rule(selector, fullscreen_state, content, suppress_event)
	local rule = {
		match = selector,
		workspace = policies.workspace .. " silent",
		no_anim = true,
		border_size = 0,
		rounding = 0,
		opacity = "1.0 override 1.0 override",
		fullscreen_state = fullscreen_state,
		immediate = true,
	}

	if content ~= nil then
		rule.content = content
	end
	if suppress_event ~= nil then
		rule.suppress_event = suppress_event
	end
	return rule
end

local function launcher_window_rule(launcher_rule)
	local rule = {
		match = launcher_rule.match,
		workspace = policies.workspace .. " silent",
		no_anim = true,
		no_blur = true,
		no_shadow = true,
		border_size = 0,
		rounding = 0,
	}

	for property, value in pairs(launcher_rule) do
		if property ~= "match" then
			rule[property] = value
		end
	end

	return rule
end

local function register_gamescope_rules()
	hl.window_rule({
		match = { class = "^(gamescope)$" },
		workspace = policies.workspace .. " silent",
		tile = true,
		content = "game",
	})

	hl.window_rule({
		-- Game clients can briefly report non-game content while mapping.
		match = {
			workspace = policies.workspace,
			class = collection_class_exclusion,
			content = "negative:^game$",
			initial_title = collection_initial_title_exclusion,
		},
		workspace = "special:gaming-overlay silent",
	})
end

local function register_steam_rules()
	hl.window_rule({ match = { class = "^(steam)$", title = "^$" }, stay_focused = true })
	hl.window_rule({ match = { class = "^(steam)$", title = "^$" }, min_size = "1 1" })

	for _, initial_title in ipairs({ "^(Friends List)$", "^(Add Non-Steam Game)$" }) do
		hl.window_rule({ match = { initial_title = initial_title }, float = true })
	end
	hl.window_rule({ match = { initial_title = "^(Sign in to Steam)$" }, float = true, center = true })

	for _, game in ipairs(policies.games) do
		if game.hide_empty_wine_desktop == true and game.steam_app_id ~= nil then
			hl.window_rule({
				match = { class = "^(steam_app_" .. game.steam_app_id .. ")$", initial_title = "^$" },
				workspace = "special:wine-helpers silent",
				no_initial_focus = true,
			})
		end
	end

	for _, selector in ipairs({
		{ class = "^(steam_app_[0-9]+)$", initial_title = collection_initial_title_exclusion },
		{ initial_class = "^(steam_app_[0-9]+)$", initial_title = collection_initial_title_exclusion },
	}) do
		hl.window_rule(gaming_window_rule(selector, nil, "game"))
	end

	hl.window_rule({ match = { xdg_tag = "^proton[-]game$" }, content = "game" })
end

local function register_game_rules()
	for _, game in ipairs(policies.games) do
		if game.fullscreen_state ~= nil or game.route_to_gaming_workspace == true then
			for _, selector in ipairs(game.selectors) do
				hl.window_rule(gaming_window_rule(selector, game.fullscreen_state, "game", game.suppress_event))
			end
		end

		for _, launcher_rule in ipairs(game.launcher_rules or {}) do
			hl.window_rule(launcher_window_rule(launcher_rule))
		end
	end
end

function M.register()
	register_gamescope_rules()
	register_steam_rules()
	register_game_rules()
	-- SteamGridDB's browser-extension companion needs to stay above the Steam client.
	hl.window_rule({ match = { class = "^(SGDBoop)$" }, float = true, pin = true })
end

return M
