-- Window state persistence selectors.
-- Source selector list read by runtime/windows/daemons/window-state/window-state.sh.

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

---@return WindowStateSelector[]
return {
  { matcher = "match:class", pattern = [=[^nemo$]=] },
	{ matcher = "match:class", pattern = [=[^xdg-desktop-portal-gtk$]=] },
	{ matcher = "match:class", pattern = [=[^Bitwarden$]=] },
  { matcher = "match:class", pattern = [=[^org\.gnome\.TextEditor$]=] },
  { matcher = "match:class", pattern = [=[^org\.gnome\.Loupe$]=] },
  { matcher = "match:class", pattern = [=[^flake_update_terminal$]=] },
	{ matcher = "match:class", pattern = [=[^Mullvad VPN$]=] },
	{ matcher = "match:class", pattern = [=[nz\.co\.mega\.]=] },
  { matcher = "match:class", pattern = [=[^org\.gnome\.FileRoller$]=] },
  { matcher = "match:initial_title", pattern = [=[^Infinitefusion$]=] },
  { matcher = "match:class", pattern = [=[^GParted$]=] },
  { matcher = "match:class", pattern = [=[^net\.davidotek\.pupgui2$]=] },
  { matcher = "match:class", pattern = [=[^io\.github\.efogdev\.mpris-timer$]=] },
  { matcher = "match:class", pattern = [=[^zenity$]=] },
  { matcher = "match:class", pattern = [=[^steam_app_0$]=] },
  { matcher = "match:class", pattern = [=[^org\.signal\.Signal$]=] },
}
