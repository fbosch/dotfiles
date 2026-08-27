-- Window state persistence selectors.
-- Source selector list read by runtime/windows/daemons/window-state/window-state.sh.

local pip = require("lib.picture_in_picture")

---@alias WindowStateMatcher
---| "match:class" # Hyprland client class.
---| "match:title" # Hyprland client title.
---| "match:initialClass" # Initial client class.
---| "match:initial_class" # Initial client class.
---| "match:initialTitle" # Initial client title.
---| "match:initial_title" # Initial client title.

---@class WindowStateSelector
---@field matcher WindowStateMatcher Identifies the client field and emitted window-rule selector.
---@field pattern string Regex preserved as-is, or a literal string matched exactly by generated rules.
---@field exclude? { matcher: WindowStateMatcher, patterns: string[] } Excludes clients matching this field and any pattern.
---@field persist_tags? string[] Dynamic client tags to restore when present.
---@field persist_tag_animations? table<string, string> Entry animation for each persisted tag.
---@field geometry_authority? "pip" Excludes geometry from generic capture and accepts it through the PiP port.
---@field per_monitor? boolean Retains independent monitor-relative state; defaults to true.
---@field restore_monitor? boolean Restores the monitor captured by a global selector.
---@field restore_size? boolean Emits a generated size rule; defaults to true.

---@return WindowStateSelector[]
return {
	{
		matcher = "match:class",
		pattern = [=[^nemo$]=],
		exclude = {
			matcher = "match:initial_title",
			patterns = { [=[^File Operations$]=], [=[^Preparing$]=] },
		},
	},
	{ matcher = "match:class", pattern = [=[^xdg-desktop-portal-gtk$]=] },
	{ matcher = "match:class", pattern = [=[^Bitwarden$]=] },
	{ matcher = "match:class", pattern = [=[^org\.gnome\.TextEditor$]=] },
	{ matcher = "match:class", pattern = [=[^flake_update_terminal$]=] },
	{ matcher = "match:class", pattern = [=[^Mullvad VPN$]=] },
	{ matcher = "match:class", pattern = [=[nz\.co\.mega\.]=] },
	{ matcher = "match:initial_title", pattern = [=[^Infinitefusion$]=] },
	{ matcher = "match:class", pattern = [=[^GParted$]=] },
	{ matcher = "match:class", pattern = [=[^net\.davidotek\.pupgui2$]=] },
	{ matcher = "match:class", pattern = [=[^io\.github\.efogdev\.mpris-timer$]=] },
	{ matcher = "match:class", pattern = [=[^steam_app_0$]=] },
	{ matcher = "match:class", pattern = [=[^org\.signal\.Signal$]=] },
	{ matcher = "match:class", pattern = [=[^SVPManager$]=] },
	{ matcher = "match:initial_title", pattern = [=[^Battle\.net$]=] },
	{ matcher = "match:initial_title", pattern = [=[^Zenimax Online Studios Launcher$]=] },
	{ matcher = "match:initial_title", pattern = [=[^Codex$]=] },
	{
		matcher = "match:initial_title",
		pattern = [=[^Picture-in-Picture$]=],
		geometry_authority = "pip",
		persist_tags = {
			"pip-top-left",
			"pip-top-right",
			"pip-bottom-left",
			"pip-bottom-right",
		},
		persist_tag_animations = pip.corner_tag_animations,
		per_monitor = false,
		restore_monitor = true,
		restore_size = false,
	},
	{ matcher = "match:class", pattern = [=[^com\.github\.tchx84\.Flatseal$]=] },
	{ matcher = "match:class", pattern = [=[^org\.gnome\.Calendar$]=] },
}
