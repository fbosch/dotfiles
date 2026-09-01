local window_tags = require("lib.window_tags")
local monitor_role = require("lib.monitor_role")
require("gaming").register_window_rules()
require("lib.picture_in_picture").register_window_rules()
require("rules.ags").register()
require("rules.initial_window_state").register()
require("rules.transient_placement").register()

-- GTK Application
hl.window_rule({ match = { class = "^(GTK Application)$" }, float = true })

-- Bitwarden
hl.window_rule({
	match = { class = "^(Bitwarden)$" },
	float = true,
	size = "900 900",
	tag = "+" .. window_tags.privacy,
})

-- Signal
hl.window_rule({ match = { class = "^(org\\.signal\\.Signal)$" }, float = true, tag = "+" .. window_tags.privacy })

-- Discord
hl.window_rule({ match = { class = "^(discord|com\\.discordapp\\.Discord)$" }, tag = "+" .. window_tags.privacy })

-- GNOME Applications (general)
hl.window_rule({ match = { class = "^(org\\.gnome\\.Calculator)$" }, float = true, persistent_size = true })
hl.window_rule({ match = { class = "^(org\\.gnome\\.Calendar)$" }, float = true, center = true, persistent_size = true })
hl.window_rule({ match = { class = "^(org\\.gnome\\.TextEditor)$" }, float = true })
hl.window_rule({
	match = { class = "^(org\\.gnome\\.Loupe)$" },
	float = true,
	size = "1000 700",
	persistent_size = true,
})

-- Plexamp
hl.window_rule({ match = { class = "Plexamp" }, float = true, size = "360 620" })

-- Media Downloader
hl.window_rule({ match = { class = "^(media-downloader)$" }, float = true, size = "900 450", center = true })

-- VLC
hl.window_rule({ match = { class = "^(vlc)$" }, content = "video" })

-- mpv
hl.window_rule({ match = { class = "^(mpv)$" }, float = true, content = "video" })

-- SVP
hl.window_rule({ match = { class = "^(SVPManager)$" }, float = true })

-- OpenPets
hl.window_rule({ match = { title = "^(OpenPets Default Pet)$" }, no_blur = true, no_shadow = true, border_size = 0 })

-- Flatseal
hl.window_rule({ match = { class = "^(com\\.github\\.tchx84\\.Flatseal)$" }, float = true, persistent_size = true })

-- Font Viewer (GNOME)
hl.window_rule({ match = { class = "^(org\\.gnome\\.font-viewer)$" }, float = true })

-- GCR Prompter
hl.window_rule({ match = { class = "^(gcr-prompter)$" }, pin = true, tag = "+" .. window_tags.privacy })

-- Mullvad VPN
hl.window_rule({ match = { class = "^(Mullvad VPN)$" }, float = true, pin = true })

-- Nemo File Manager
hl.window_rule({ match = { class = "^(nemo)$" }, float = true, no_anim = true })
hl.window_rule({
	match = { class = "^(nemo)$", initial_title = "^(Preparing|File Operations)$" },
	stay_focused = true,
})

-- File Roller
hl.window_rule({ match = { class = "^(org\\.gnome\\.FileRoller)$" }, float = true, no_anim = true })

-- Network Manager Connection Editor
hl.window_rule({
	match = { class = "^(nm-connection-editor)$" },
	float = true,
	pin = true,
	no_anim = true,
	move = "onscreen 100% 100%",
})
hl.window_rule({
	match = { class = "^(nm-connection-editor)$", initial_title = "^(Network Connections)$" },
	size = "350 270",
})

-- Proton VPN
hl.window_rule({ match = { class = "^(protonvpn-app)$" }, float = true, pin = true, move = "onscreen 100% 100%" })
hl.window_rule({ match = { class = "^(protonvpn\\.app)$", title = "^(Proton VPN)$" }, float = true })

-- Proton Mail
hl.window_rule({
	match = { class = "^(chrome-mail\\.proton\\.me__-ProtonmailProfile)$" },
	workspace = "1",
	tag = "+" .. window_tags.privacy,
})

-- Vicinae
hl.window_rule({
	match = { initial_title = "^(Vicinae (Launcher|Settings))$" },
	no_anim = true,
	border_size = 0,
	rounding = 10,
	no_shadow = false,
})

-- Warehouse (Flattool)
hl.window_rule({ match = { class = "^(io\\.github\\.flattool\\.Warehouse)$" }, float = true, size = "750 900" })

-- XDG Desktop Portal GTK (File Picker)
hl.window_rule({ match = { class = "^(xdg-desktop-portal-gtk)$" }, float = true, pin = true, no_anim = true })

-- Zen Browser
hl.window_rule({ match = { class = "^(app\\.zen_browser\\.zen-popup)$" }, size = "730 900", float = true })

-- Helium Browser
hl.window_rule({ match = { class = "^(helium-popup)$" }, size = "730 900", float = true })
hl.window_rule({
	match = { class = "^(Bitwarden|app[.]zen_browser[.]zen-popup|helium-popup)$" },
	tag = "+" .. window_tags.popup,
})
hl.window_rule({ match = { tag = window_tags.popup }, suppress_event = "maximize" })

-- Floorp Browser
hl.window_rule({
	match = { class = "^(one\\.ablaze\\.floorp)$" },
	monitor = monitor_role.name_for(monitor_role.portrait),
	tag = "+" .. window_tags.privacy,
})
hl.window_rule({
	match = { class = "^(floorp)$" },
	monitor = monitor_role.name_for(monitor_role.portrait),
	tag = "+" .. window_tags.privacy,
})

-- xfreerdp (FreeRDP)
hl.window_rule({ match = { initial_class = "^(xfreerdp)$" }, fullscreen = true })

-- MEGAsync
hl.window_rule({ match = { class = "nz.mega.MEGAsync" }, float = true })
hl.window_rule({ match = { initial_title = "^(MEGAsync)$" }, float = true, pin = true, rounding = 15 })
hl.window_rule({ match = { initial_class = "nz.co.mega" }, float = true })

-- Wine
hl.window_rule({ match = { class = "^(winecfg\\.exe)$" }, float = true })

-- Zenity
hl.window_rule({
	match = { initial_class = "^(zenity)$" },
	float = true,
	size = "525 600",
	border_size = 0,
	rounding = 0,
	no_shadow = true,
	opacity = "1.0 override 1.0 override",
})
hl.window_rule({ match = { class = "^(zenity)$" }, no_blur = true })

-- Codex pet :)
hl.window_rule({
	match = { initial_title = "^Codex$", initial_class = "^chatgpt$" },
	no_blur = true,
	no_shadow = true,
	border_size = 0,
	tag = "+" .. window_tags.non_resizable,
})

-- Must follow app-specific privacy tag assignment rules.
hl.window_rule({ match = { tag = window_tags.privacy }, no_screen_share = true })
