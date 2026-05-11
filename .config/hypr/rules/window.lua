-- Static window rules ported from rules.conf.
-- Preserve declaration order.

local taskbar_apps = require("taskbar")

-- Gamescope
hl.window_rule({
  match = { class = "^(gamescope)$" },
  workspace = "10 silent",
  tile = true,
  fullscreen = true,
})

-- Gaming overlay scratchpad
hl.window_rule({
  match = { workspace = "10", class = "negative:^(gamescope)$" },
  workspace = "special:gaming-overlay silent",
})

-- GTK Application
hl.window_rule({ match = { class = "^(GTK Application)$" }, float = true })

-- Bitwarden
hl.window_rule({ match = { class = "^(Bitwarden)$" }, float = true, size = "900 900" })

-- GNOME Applications (general)
hl.window_rule({ match = { class = "^(org\\.gnome\\.Calculator)$" }, float = true })
hl.window_rule({ match = { class = "^(org\\.gnome\\.TextEditor)$" }, float = true })
hl.window_rule({ match = { class = "^(org\\.gnome\\.Loupe)$" }, float = true })
taskbar_apps.apply_rules()

-- Plexamp
hl.window_rule({ match = { class = "Plexamp" }, float = true, size = "360 620" })

-- Flatseal
hl.window_rule({ match = { class = "^(com\\.github\\.tchx84\\.Flatseal)$" }, float = true })

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
hl.window_rule({ match = { class = "^(nm-connection-editor)$", initial_title = "^(Network Connections)$" }, size = "350 270" })

-- Proton VPN
hl.window_rule({ match = { class = "^(protonvpn-app)$" }, float = true, pin = true, move = "onscreen 100% 100%" })
hl.window_rule({ match = { class = "^(protonvpn\\.app)$", title = "^(Proton VPN)$" }, float = true })

-- Proton Mail
hl.window_rule({ match = { class = "^(chrome-mail\\.proton\\.me__-ProtonmailProfile)$" }, workspace = "2" })

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
hl.window_rule({ match = { title = "^([Pp]icture-in-[Pp]icture)$" }, float = true, no_initial_focus = true, pin = true })
hl.window_rule({ match = { title = "([Pp]icture-in-[Pp]icture)" }, animation = "slide right" })
hl.window_rule({ match = { initial_title = "(^(Picture-in-Picture)$)" }, size = "688 388", move = "2739 993" })

-- Floorp Browser
hl.window_rule({ match = { class = "^(one\\.ablaze\\.floorp)$" }, monitor = "HDMI-A-2" })
hl.window_rule({ match = { class = "^(floorp)$" }, monitor = "HDMI-A-2" })

-- Winboat
hl.window_rule({ match = { class = "(winboat)" }, float = true })
hl.window_rule({ match = { initial_class = "^(winboat-⚙️ Windows Explorer)$" }, float = true })
hl.window_rule({ match = { initial_class = "^(winboat-Huetrofor Hue)$" }, float = true, size = "1460 880", move = "3255 779" })

-- xfreerdp (FreeRDP)
hl.window_rule({ match = { initial_class = "^(xfreerdp)$" }, fullscreen = true })

-- MEGAsync
hl.window_rule({ match = { class = "nz.mega.MEGAsync" }, float = true })
hl.window_rule({ match = { initial_title = "^(MEGAsync)$" }, float = true, pin = true, rounding = 15 })
hl.window_rule({ match = { initial_class = "nz.co.mega" }, float = true })

-- Steam
hl.window_rule({ match = { initial_title = "^(Friends List)$" }, float = true })
hl.window_rule({ match = { initial_title = "^(Add Non-Steam Game)$" }, float = true })
hl.window_rule({ match = { initial_title = "^(Sign in to Steam)$" }, float = true, center = true })

-- Steam games
hl.window_rule({
  match = { class = "^(steam_app_0)" },
  no_anim = true,
  border_size = 0,
  rounding = 0,
  no_shadow = true,
  opacity = "1.0 override 1.0 override",
})

-- SGDBoop
hl.window_rule({ match = { class = "^(SGDBoop)$" }, float = true, pin = true })

-- Wine
hl.window_rule({ match = { class = "^(winecfg\\.exe)$" }, float = true })

-- Battle.net
hl.window_rule({ match = { initial_title = "^(Battle\\.net Login)$" }, workspace = "10 silent" })
hl.window_rule({ match = { initial_title = "^(Battle.net Login)$" }, no_anim = true, rounding = 0, border_size = 0 })
hl.window_rule({ match = { initial_title = "^(Battle\\.net)$" }, workspace = "10 silent" })
hl.window_rule({ match = { initial_title = "^(Battle.net)$" }, no_anim = true, rounding = 0, border_size = 0 })
hl.window_rule({ match = { initial_title = "^(Battle\\.net Settings)$" }, workspace = "10 silent" })
hl.window_rule({ match = { initial_title = "^(Battle.net Settings)$" }, no_anim = true, rounding = 0, border_size = 0, pin = true })

-- World of Warcraft
hl.window_rule({
  match = { initial_title = "^(World of Warcraft)$" },
  workspace = "10 silent",
  no_anim = true,
  border_size = 0,
  rounding = 0,
  no_shadow = true,
  opacity = "1.0 override 1.0 override",
})
hl.window_rule({
  match = { title = "^(World of Warcraft)$" },
  workspace = "10 silent",
  no_anim = true,
  border_size = 0,
  rounding = 0,
  no_shadow = true,
  opacity = "1.0 override 1.0 override",
})

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
hl.window_rule({ match = { class = "^(zenity)$" }, no_blur = true })
