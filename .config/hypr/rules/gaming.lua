local M = {}

M.workspace = "10"
M.default_presentation = {
	vrr = 3,
	direct_scanout = 0,
}

---@alias GamingSelector table<string, string>

---@class GamingPresentation
---@field vrr? integer Hyprland `misc:vrr` override.
---@field direct_scanout? integer Hyprland `render:direct_scanout` override.

---@class GamingPolicy
---@field name string Stable policy identifier.
---@field selectors GamingSelector[] Window selectors shared by Hyprland and the watchdog.
---@field launcher_selectors? GamingSelector[] Launcher windows that receive lifecycle and cosmetic rules only.
---@field steam_app_id? string UMU Steam app ID used for matching the Steam client class.
---@field hide_empty_wine_desktop? boolean Hides Wine's untitled virtual desktop helper.
---@field fullscreen_state? string Hyprland internal and client fullscreen states.
---@field suppress_event? string Hyprland event to suppress for the matching window.
---@field focus_on_open? boolean Focus the window once after it opens.
---@field enable_profile? boolean Activates the gaming profile for this window.
---@field exclude_profile? boolean Prevents this window from activating the gaming profile.
---@field freeze? boolean `false` excludes this window from watchdog `wl-freeze` handling.
---@field confirm_close? boolean Requires confirmation before `CMD+W` closes this window.
---@field force_close? boolean Makes `CMD+W` kill the owning process instead of requesting a close.
---@field presentation? GamingPresentation Presentation settings applied when the gaming profile activates.

---@type GamingPolicy[]
M.games = {
	{
		name = "bg3",
		selectors = {
			{ class = "^bg3$" },
			{ class = "^steam_app_1086940$" },
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
		steam_app_id = "worldofwarcraft",
		hide_empty_wine_desktop = true,
		selectors = {
			{ class = "^(gamescope)$", title = "^World of Warcraft$" },
			{ initial_title = "^World of Warcraft$" },
			{ title = "^World of Warcraft$" },
		},
		launcher_selectors = {
			{ initial_title = "^Battle\\.net" },
			{ title = "^Battle\\.net" },
		},
		fullscreen_state = "2 0",
		enable_profile = true,
		freeze = false,
		confirm_close = true,
		presentation = {
			vrr = 0,
			direct_scanout = 0,
		},
	},
	{
		name = "elder-scrolls-online",
		steam_app_id = "elderscrollsonline",
		hide_empty_wine_desktop = true,
		selectors = {},
		launcher_selectors = {
			{ initial_title = "^Zenimax Online Studios Launcher$" },
			{ title = "^Zenimax Online Studios Launcher$" },
		},
		freeze = false,
		confirm_close = true,
	},
	{
		name = "faugus",
		selectors = {
			{ initial_title = "[Ff]augus" },
			{ title = "[Ff]augus" },
		},
		exclude_profile = true,
		freeze = false,
		force_close = true,
	},
	{
		name = "gamescope",
		selectors = {
			{ class = "^(gamescope)$" },
		},
		confirm_close = true,
	},
	{
		name = "game-content",
		selectors = {
			{ content = "^game$" },
		},
		enable_profile = true,
		confirm_close = true,
	},
}

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
	for _, game in ipairs(M.games) do
		for _, selector in ipairs(game.selectors) do
			if M.matches_selector(window, selector) then
				return game, false
			end
		end

		for _, selector in ipairs(game.launcher_selectors or {}) do
			if M.matches_selector(window, selector) then
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

local function gaming_window_rule(selector, fullscreen_state, content, suppress_event)
	local rule = {
		match = selector,
		workspace = M.workspace .. " silent",
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

local function launcher_window_rule(selector)
	return {
		match = selector,
		workspace = M.workspace .. " silent",
		no_anim = true,
		no_blur = true,
		no_shadow = true,
		border_size = 0,
		rounding = 0,
	}
end

local function register_gamescope_rules()
	hl.window_rule({
		match = { class = "^(gamescope)$" },
		workspace = M.workspace .. " silent",
		tile = true,
		fullscreen_state = "2 0",
		content = "game",
	})

	hl.window_rule({
		match = { workspace = M.workspace, class = "negative:^(gamescope)$" },
		workspace = "special:gaming-overlay silent",
	})
end

local function register_steam_rules()
	for _, initial_title in ipairs({ "^(Friends List)$", "^(Add Non-Steam Game)$" }) do
		hl.window_rule({ match = { initial_title = initial_title }, float = true })
	end
	hl.window_rule({ match = { initial_title = "^(Sign in to Steam)$" }, float = true, center = true })

	for _, game in ipairs(M.games) do
		if game.hide_empty_wine_desktop == true and game.steam_app_id ~= nil then
			hl.window_rule({
				match = { class = "^(steam_app_" .. game.steam_app_id .. ")$", initial_title = "^$" },
				workspace = "special:wine-helpers silent",
				no_initial_focus = true,
			})
		end
	end

	for _, selector in ipairs({ { class = "^(steam_app_[0-9]+)$" }, { initial_class = "^(steam_app_[0-9]+)$" } }) do
		hl.window_rule(gaming_window_rule(selector, "2 2", "game"))
	end

	hl.window_rule({ match = { xdg_tag = "^proton[-]game$" }, content = "game" })
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
		local game, is_launcher = M.match(window)
		if game == nil or is_launcher or game.focus_on_open ~= true then
			return
		end

		hl.dispatch(hl.dsp.focus({ window = "address:" .. window.address }))
	end)
end

local function register_game_client_rules()
	hl.window_rule({ match = { class = "^(SGDBoop)$" }, float = true, pin = true })
	hl.window_rule({ match = { initial_title = "^(Larian Launcher)$" }, float = true, decorate = false })

	for _, game in ipairs(M.games) do
		for _, selector in ipairs(game.launcher_selectors or {}) do
			hl.window_rule(launcher_window_rule(selector))
		end
	end

	hl.window_rule({
		match = { initial_title = "^(Battle\\.net Settings)$" },
		pin = true,
	})
end

local function set_fullscreen_state(window, game)
	if game.fullscreen_state == nil then
		return
	end

	local internal, client = game.fullscreen_state:match("^(%d+) (%d+)$")
	internal = tonumber(internal)
	client = tonumber(client)
	if window.fullscreen == internal and window.fullscreen_client == client then
		return
	end

	hl.dispatch(hl.dsp.window.fullscreen_state({
		internal = internal,
		client = client,
		action = "set",
		window = "address:" .. window.address,
	}))
end

local function register_fullscreen_handler()
	hl.on("window.fullscreen", function(window)
		local game, is_launcher = M.match(window)
		if game ~= nil and is_launcher == false then
			set_fullscreen_state(window, game)
		end
	end)

	hl.on("window.active", function(window)
		local game, is_launcher = M.match(window)
		if game == nil or is_launcher or game.presentation == nil or game.presentation.direct_scanout ~= 1 then
			return
		end

		set_fullscreen_state(window, game)
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
