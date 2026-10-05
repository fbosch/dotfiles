-- Stable native identities for the declarative persistence policy.
local window_state_selectors = require("rules.window-state-selectors")

local ids = {
	[ [=[^nemo$]=] ] = "nemo-main",
	[ [=[^xdg-desktop-portal-gtk$]=] ] = "desktop-portal-gtk",
	[ [=[^Bitwarden$]=] ] = "bitwarden",
	[ [=[^org\.gnome\.TextEditor$]=] ] = "gnome-text-editor",
	[ [=[^flake_update_terminal$]=] ] = "flake-update-terminal",
	[ [=[^Mullvad VPN$]=] ] = "mullvad-vpn",
	[ [=[^Infinitefusion$]=] ] = "infinitefusion",
	[ [=[^GParted$]=] ] = "gparted",
	[ [=[^net\.davidotek\.pupgui2$]=] ] = "pupgui2",
	[ [=[^io\.github\.efogdev\.mpris-timer$]=] ] = "mpris-timer",
	[ [=[^steam_app_0$]=] ] = "steam-app-0",
	[ [=[^org\.signal\.Signal$]=] ] = "signal",
	[ [=[^SVPManager$]=] ] = "svp-manager",
	[ [=[^Battle\.net$]=] ] = "battle-net",
	[ [=[^Zenimax Online Studios Launcher$]=] ] = "zenimax-launcher",
	[ [=[^Codex$]=] ] = "codex",
	[ [=[^Picture-in-Picture$]=] ] = "picture-in-picture",
	[ [=[^com\.github\.tchx84\.Flatseal$]=] ] = "flatseal",
	[ [=[^org\.gnome\.Calendar$]=] ] = "gnome-calendar",
}

local selectors = {}
local seen = {}
for _, source in ipairs(window_state_selectors) do
	local id = ids[source.pattern]
	assert(id and not seen[id], "unmapped or duplicate persistent-position selector: " .. source.pattern)
	seen[id] = true
	selectors[#selectors + 1] = {
		id = id,
		matcher = source.matcher,
		pattern = source.pattern,
		exclude = source.exclude,
		per_monitor = source.per_monitor ~= false,
		restore_size = source.restore_size ~= false,
		force_windowed = source.force_windowed ~= false,
		restore_monitor = source.restore_monitor == true,
		geometry_authority = source.geometry_authority or "generic",
	}
end
assert(#selectors == 19, "persistent-position selector policy changed; review its stable IDs")

return selectors
