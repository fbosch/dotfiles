local M = {}

M.default_presentation = {
	vrr = 2,
	direct_scanout = 0,
}

M.games = {
	{
		name = "bg3",
		selectors = {
			{ class = "^(bg3)$" },
		},
		fullscreen_state = "2 0",
		suppress_event = "fullscreen",
		enable_profile = true,
		freeze = false,
		presentation = {
			vrr = 2,
			direct_scanout = 0,
		},
	},
	{
		name = "world-of-warcraft",
		selectors = {
			{ class = "^(gamescope)$", title = "^World of Warcraft" },
			{ initial_title = "^World of Warcraft" },
			{ title = "^World of Warcraft" },
		},
		fullscreen_state = "2 0",
		enable_profile = true,
		freeze = false,
		presentation = {
			vrr = 2,
			direct_scanout = 1,
		},
	},
	{
		name = "battle-net",
		selectors = {
			{ initial_title = "^Battle\\.net" },
			{ title = "^Battle\\.net" },
		},
		freeze = false,
	},
}

local function matches_pattern(value, pattern)
	-- Use one selector grammar for Hyprland rules and watchdog matching.
	return value:match(pattern:gsub([=[\%.]=], "%%.")) ~= nil
end

function M.matches_selector(window, selector)
	for property, pattern in pairs(selector) do
		if type(window[property]) ~= "string" or not matches_pattern(window[property], pattern) then
			return false
		end
	end

	return true
end

function M.match(window)
	for _, game in ipairs(M.games) do
		for _, selector in ipairs(game.selectors) do
			if M.matches_selector(window, selector) then
				return game
			end
		end
	end

	return nil
end

function M.is_freeze_excluded(window)
	local game = M.match(window)
	return game ~= nil and game.freeze == false
end

local function gaming_window_rule(selector, fullscreen_state, content, suppress_event)
	local rule = {
		match = selector,
		workspace = "10 silent",
		no_anim = true,
		border_size = 0,
		rounding = 0,
		no_shadow = true,
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

function M.register_window_rules()
	hl.window_rule({
		match = { class = "^(gamescope)$" },
		workspace = "10 silent",
		tile = true,
		fullscreen_state = "2 2",
		immediate = true,
	})

	hl.window_rule({
		match = { workspace = "10", class = "negative:^(gamescope)$" },
		workspace = "special:gaming-overlay silent",
	})

	for _, initial_title in ipairs({ "^(Friends List)$", "^(Add Non-Steam Game)$" }) do
		hl.window_rule({ match = { initial_title = initial_title }, float = true })
	end
	hl.window_rule({ match = { initial_title = "^(Sign in to Steam)$" }, float = true, center = true })

	for _, selector in ipairs({ { class = "^(steam_app_[0-9]+)$" }, { initial_class = "^(steam_app_[0-9]+)$" } }) do
		hl.window_rule(gaming_window_rule(selector, "2 2"))
	end

	for _, game in ipairs(M.games) do
		if game.fullscreen_state ~= nil then
			for _, selector in ipairs(game.selectors) do
				hl.window_rule(gaming_window_rule(selector, game.fullscreen_state, "game", game.suppress_event))
			end
		end
	end

	hl.window_rule({ match = { class = "^(SGDBoop)$" }, float = true, pin = true })

	hl.window_rule({ match = { initial_title = "^(Battle\\.net Login)$" }, workspace = "10 silent" })
	hl.window_rule({ match = { initial_title = "^(Battle.net Login)$" }, no_anim = true, rounding = 0, border_size = 0 })
	hl.window_rule({ match = { initial_title = "^(Battle\\.net)$" }, workspace = "10 silent" })
	hl.window_rule({ match = { initial_title = "^(Battle.net)$" }, no_anim = true, rounding = 0, border_size = 0 })
	hl.window_rule({ match = { initial_title = "^(Battle\\.net Settings)$" }, workspace = "10 silent" })
	hl.window_rule({
		match = { initial_title = "^(Battle.net Settings)$" },
		no_anim = true,
		rounding = 0,
		border_size = 0,
		pin = true,
	})

	hl.on("window.fullscreen", function(window)
		if window.fullscreen == 2 then
			return
		end

		local game = M.match(window)
		if game == nil then
			return
		end

		local internal, client = game.fullscreen_state:match("^(%d+) (%d+)$")
		hl.dispatch(hl.dsp.window.fullscreen_state({
			internal = tonumber(internal),
			client = tonumber(client),
			action = "set",
			window = "address:" .. window.address,
		}))
	end)
end

return M
