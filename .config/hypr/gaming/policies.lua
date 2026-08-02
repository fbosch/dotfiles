---@alias GamingSelector table<string, string>
---@alias GamingLauncherRule table<string, boolean|GamingSelector>

---@class GamingPresentation
---@field vrr? integer Hyprland `misc:vrr` override.
---@field direct_scanout? integer Hyprland `render:direct_scanout` override.

---@class GamingPolicy
---@field name string Stable policy identifier.
---@field selectors GamingSelector[] Window selectors shared by Hyprland and the watchdog.
---@field launcher_rules? GamingLauncherRule[] Launcher windows that receive lifecycle and cosmetic rules only.
---@field close_launcher_on_start? boolean Kills matching launcher windows once the game opens.
---@field steam_app_id? string UMU Steam app ID used for matching the Steam client class.
---@field hide_empty_wine_desktop? boolean Hides Wine's untitled virtual desktop helper.
---@field route_to_gaming_workspace? boolean Applies the standard gaming workspace rule without forcing fullscreen.
---@field fullscreen_state? string Hyprland internal and client fullscreen states.
---@field suppress_event? string Hyprland event to suppress for the matching window.
---@field focus_on_open? boolean Focus the window once after it opens.
---@field enable_profile? boolean Activates the gaming profile for this window.
---@field exclude_profile? boolean Prevents this window from activating the gaming profile.
---@field freeze? boolean `false` excludes this window from watchdog `wl-freeze` handling.
---@field confirm_close? boolean Requires confirmation before `CMD+W` closes this window.
---@field force_close? boolean Makes `CMD+W` kill the owning process instead of requesting a close.
---@field presentation? GamingPresentation Presentation settings applied when the gaming profile activates.

local M = {
	workspace = "10",
	default_presentation = {
		vrr = 3,
		direct_scanout = 2,
	},
}

---@type GamingPolicy[]
M.games = {
	{
		name = "bg3",
		selectors = {
			{ class = "^bg3$" },
			{ class = "^steam_app_1086940$", initial_title = "^Window$" },
		},
		launcher_rules = {
			{ match = { initial_title = "^Larian Launcher$" }, float = true, decorate = false },
			{ match = { title = "^Larian Launcher$" }, float = true, decorate = false },
			{ match = { initial_title = "^LariLauncher$" }, float = true, decorate = false },
			{ match = { title = "^LariLauncher$" }, float = true, decorate = false },
		},
		close_launcher_on_start = true,
		fullscreen_state = "2 0",
		suppress_event = "fullscreen",
		focus_on_open = true,
		enable_profile = true,
		freeze = false,
		confirm_close = true,
		presentation = {
			vrr = 0,
			direct_scanout = 0,
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
		launcher_rules = {
			{ match = { initial_title = "^Battle\\.net" } },
			{ match = { title = "^Battle\\.net" } },
			{ match = { initial_title = "^Battle\\.net Settings$" }, pin = true },
		},
		close_launcher_on_start = true,
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
		route_to_gaming_workspace = true,
		selectors = {
			{ class = "^(steam_app_elderscrollsonline)$", initial_title = "^Elder Scrolls Online$" },
			{ class = "^(steam_app_elderscrollsonline)$", title = "^Elder Scrolls Online$" },
		},
		launcher_rules = {
			{ match = { initial_title = "^Zenimax Online Studios Launcher$" } },
			{ match = { title = "^Zenimax Online Studios Launcher$" } },
		},
		close_launcher_on_start = true,
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

return M
