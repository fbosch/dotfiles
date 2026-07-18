-- Static window rules ported from rules.conf.
-- Preserve declaration order.

require("rules.gaming").register_window_rules()

-- GTK Application
hl.window_rule({ match = { class = "^(GTK Application)$" }, float = true })

-- Bitwarden
hl.window_rule({ match = { class = "^(Bitwarden)$" }, float = true, size = "900 900" })

-- Signal
hl.window_rule({ match = { class = "^(org\\.signal\\.Signal)$" }, float = true })

-- GNOME Applications (general)
hl.window_rule({ match = { class = "^(org\\.gnome\\.Calculator)$" }, float = true, persistent_size = true })
hl.window_rule({ match = { class = "^(org\\.gnome\\.TextEditor)$" }, float = true })
hl.window_rule({ match = { class = "^(org\\.gnome\\.Loupe)$" }, float = true })

-- Plexamp
hl.window_rule({ match = { class = "Plexamp" }, float = true, size = "360 620" })

-- OpenPets
hl.window_rule({ match = { title = "^(OpenPets Default Pet)$" }, no_blur = true, no_shadow = true, border_size = 0 })

-- Flatseal
hl.window_rule({ match = { class = "^(com\\.github\\.tchx84\\.Flatseal)$" }, float = true, persistent_size = true })

-- Font Viewer (GNOME)
hl.window_rule({ match = { class = "^(org\\.gnome\\.font-viewer)$" }, float = true })

-- Flake Update Terminal
hl.window_rule({ match = { class = "^(flake_update_terminal)$" }, float = true, pin = true })

-- GCR Prompter
hl.window_rule({ match = { class = "^(gcr-prompter)$" }, pin = true })

-- Mullvad VPN
hl.window_rule({ match = { class = "^(Mullvad VPN)$" }, float = true, pin = true })

-- Nemo File Manager
hl.window_rule({ match = { class = "^(nemo)$" }, float = true, no_anim = true })

-- File Roller
hl.window_rule({ match = { class = "^(org\\.gnome\\.FileRoller)$" }, float = true })

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
hl.window_rule({ match = { class = "^(chrome-mail\\.proton\\.me__-ProtonmailProfile)$" }, workspace = "1" })

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
hl.window_rule({ match = { title = "^([Pp]icture-in-[Pp]icture)$" }, float = true, no_initial_focus = true, pin = true, content = "video" })
hl.window_rule({ match = { title = "([Pp]icture-in-[Pp]icture)" }, animation = "slide right" })
hl.window_rule({ match = { initial_title = "(^(Picture-in-Picture)$)" }, size = "688 388", move = "2739 993" })

-- Floorp Browser
hl.window_rule({ match = { class = "^(one\\.ablaze\\.floorp)$" }, monitor = "HDMI-A-2" })
hl.window_rule({ match = { class = "^(floorp)$" }, monitor = "HDMI-A-2" })

-- Winboat
hl.window_rule({ match = { class = "(winboat)" }, float = true })
hl.window_rule({ match = { initial_class = "^(winboat-⚙️ Windows Explorer)$" }, float = true })
hl.window_rule({
	match = { initial_class = "^(winboat-Huetrofor Hue)$" },
	float = true,
	size = "1460 880",
	move = "3255 779",
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
	border_size = 0,
	rounding = 0,
	no_shadow = true,
	no_anim = true,
	opacity = "1.0 override 1.0 override",
})
hl.window_rule({ match = { class = "^(zenity)$" }, no_anim = true, no_blur = true })
