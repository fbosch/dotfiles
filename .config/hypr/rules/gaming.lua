local M = {}

M.default_presentation = {
	vrr = 2,
	direct_scanout = 0,
}

---@alias GamingSelector table<string, string>

---@class GamingPresentation
---@field vrr integer Hyprland `misc:vrr` value.
---@field direct_scanout integer Hyprland `render:direct_scanout` value.

---@class GamingPolicy
---@field name string Stable policy identifier.
---@field selectors GamingSelector[] Window selectors shared by Hyprland and the watchdog.
---@field fullscreen_state? string Hyprland internal and client fullscreen states.
---@field suppress_event? string Hyprland event to suppress for the matching window.
---@field focus_on_open? boolean Focus the window once after it opens.
---@field enable_profile? boolean Activates the gaming profile for this window.
---@field exclude_profile? boolean Prevents this window from activating the gaming profile.
---@field freeze? boolean `false` excludes this window from watchdog `wl-freeze` handling.
---@field confirm_close? boolean Requires confirmation before `CMD+W` closes this window.
---@field presentation? GamingPresentation Presentation settings when the gaming profile is active.

---@type GamingPolicy[]
M.games = {
	{
		name = "bg3",
		selectors = {
			{ class = "^(bg3)$" },
		},
		fullscreen_state = "2 0",
		suppress_event = "fullscreen",
		focus_on_open = true,
		enable_profile = true,
		freeze = false,
		confirm_close = true,
		presentation = {
			vrr = 0,
			direct_scanout = 1,
		},
	},
	{
		name = "world-of-warcraft",
		selectors = {
			{ class = "^(gamescope)$", title = "^World of Warcraft$" },
			{ initial_title = "^World of Warcraft$" },
			{ title = "^World of Warcraft$" },
		},
		fullscreen_state = "2 0",
		enable_profile = true,
		freeze = false,
		confirm_close = true,
		presentation = {
			vrr = 2,
			direct_scanout = 0,
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
	{
		name = "faugus",
		selectors = {
			{ initial_title = "[Ff]augus" },
			{ title = "[Ff]augus" },
		},
		exclude_profile = true,
	},
	{
		name = "gamescope",
		selectors = {
			{ class = "^(gamescope)$" },
		},
		confirm_close = true,
	},
	{
		name = "steam-app",
		selectors = {
			{ class = "^(steam_app_[0-9]+)$" },
			{ initial_class = "^(steam_app_[0-9]+)$" },
		},
		confirm_close = true,
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

function M.is_profile_excluded(window)
	local game = M.match(window)
	return game ~= nil and game.exclude_profile == true
end

function M.requires_close_confirmation(window)
	local game = M.match(window)
	return game ~= nil and game.confirm_close == true
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

local function register_gamescope_rules()
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
end

local function register_steam_rules()
	for _, initial_title in ipairs({ "^(Friends List)$", "^(Add Non-Steam Game)$" }) do
		hl.window_rule({ match = { initial_title = initial_title }, float = true })
	end
	hl.window_rule({ match = { initial_title = "^(Sign in to Steam)$" }, float = true, center = true })

	for _, selector in ipairs({ { class = "^(steam_app_[0-9]+)$" }, { initial_class = "^(steam_app_[0-9]+)$" } }) do
		hl.window_rule(gaming_window_rule(selector, "2 2"))
	end
end

local function register_game_rules()
	for _, game in ipairs(M.games) do
		if game.fullscreen_state ~= nil then
			for _, selector in ipairs(game.selectors) do
				hl.window_rule(gaming_window_rule(selector, game.fullscreen_state, "game", game.suppress_event))
			end
		end
	end
end

local function register_open_handler()
	hl.on("window.open", function(window)
		local game = M.match(window)
		if game == nil or game.focus_on_open ~= true then
			return
		end

		hl.dispatch(hl.dsp.focus({ window = "address:" .. window.address }))
	end)
end

local function register_game_client_rules()
	hl.window_rule({ match = { class = "^(SGDBoop)$" }, float = true, pin = true })
	hl.window_rule({ match = { initial_title = "^(Larian Launcher)$" }, float = true, decorate = false })

	local battle_net_title = "^(Battle\\.net( Login| Settings)?)$"
	hl.window_rule({
		match = { initial_title = battle_net_title },
		workspace = "10 silent",
		no_anim = true,
		rounding = 0,
		border_size = 0,
	})
	hl.window_rule({
		match = { initial_title = "^(Battle\\.net Settings)$" },
		pin = true,
	})
end

local function register_fullscreen_handler()
	hl.on("window.fullscreen", function(window)
		if window.fullscreen == 2 then
			return
		end

		local game = M.match(window)
		if game == nil or game.fullscreen_state == nil then
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

function M.register_window_rules()
	register_gamescope_rules()
	register_steam_rules()
	register_game_rules()
	register_game_client_rules()
	register_fullscreen_handler()
	register_open_handler()
end

return M
