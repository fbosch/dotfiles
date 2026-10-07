local persistence = require("plugins.persistent_position")
-- Hyprland rejects unknown custom effect fields before a plugin registers them.
if not persistence.enabled then
	return
end

hl.window_rule({
	match = {
		class = [=[^nemo$]=],
		initial_title = [=[negative:^(File Operations|Preparing)$]=],
	},
	["persistent_position:remember"] = "nemo-main",
})
hl.window_rule({
	match = { class = [=[^xdg-desktop-portal-gtk$]=] },
	["persistent_position:remember"] = "desktop-portal-gtk",
})
hl.window_rule({ match = { class = [=[^Bitwarden$]=] }, ["persistent_position:remember"] = "bitwarden" })
hl.window_rule({
	match = { class = [=[^org\.gnome\.TextEditor$]=] },
	["persistent_position:remember"] = "gnome-text-editor",
})
hl.window_rule({
	match = { class = [=[^flake_update_terminal$]=] },
	["persistent_position:remember"] = "flake-update-terminal",
})
hl.window_rule({ match = { class = [=[^Mullvad VPN$]=] }, ["persistent_position:remember"] = "mullvad-vpn" })
hl.window_rule({
	match = { initial_title = [=[^Infinitefusion$]=] },
	["persistent_position:remember"] = "infinitefusion",
})
hl.window_rule({ match = { class = [=[^GParted$]=] }, ["persistent_position:remember"] = "gparted" })
hl.window_rule({ match = { class = [=[^net\.davidotek\.pupgui2$]=] }, ["persistent_position:remember"] = "pupgui2" })
hl.window_rule({
	match = { class = [=[^io\.github\.efogdev\.mpris-timer$]=] },
	["persistent_position:remember"] = "mpris-timer",
})
hl.window_rule({ match = { class = [=[^steam_app_0$]=] }, ["persistent_position:remember"] = "steam-app-0" })
hl.window_rule({ match = { class = [=[^org\.signal\.Signal$]=] }, ["persistent_position:remember"] = "signal" })
hl.window_rule({ match = { class = [=[^SVPManager$]=] }, ["persistent_position:remember"] = "svp-manager" })
hl.window_rule({ match = { title = [=[^Battle\.net$]=] }, ["persistent_position:remember"] = "battle-net" })
hl.window_rule({
	match = { initial_title = [=[^Zenimax Online Studios Launcher$]=] },
	["persistent_position:remember"] = "zenimax-launcher",
})
hl.window_rule({ match = { initial_title = [=[^Codex$]=] }, ["persistent_position:remember"] = "codex" })
hl.window_rule({
	match = { initial_title = [=[^Picture-in-Picture$]=] },
	["persistent_position:remember"] = "picture-in-picture",
	["persistent_position:profile"] = "pip",
})
hl.window_rule({
	match = { class = [=[^com\.github\.tchx84\.Flatseal$]=] },
	["persistent_position:remember"] = "flatseal",
})
hl.window_rule({ match = { class = [=[^org\.gnome\.Calendar$]=] }, ["persistent_position:remember"] = "gnome-calendar" })
