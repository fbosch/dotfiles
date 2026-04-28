-- Static window rules ported from rules.conf.
-- Preserve declaration order.

-- Gamescope
hl.window_rule({ match = { class = "^(gamescope)$" }, tile = true })
hl.window_rule({ match = { class = "^(gamescope)$" }, fullscreen = true })

-- Gaming overlay scratchpad
hl.window_rule({
  match = { workspace = "10", class = "negative:^(gamescope)$" },
  workspace = "special:gaming-overlay silent",
})

-- GTK Application
hl.window_rule({ match = { class = "^(GTK Application)$" }, float = true })

-- Bitwarden
hl.window_rule({ match = { class = "^(Bitwarden)$" }, float = true })
hl.window_rule({ match = { class = "^(Bitwarden)$" }, size = "900 900" })

-- GNOME Applications (general)
hl.window_rule({ match = { class = "^(org\\.gnome\\.Calculator)$" }, float = true })
hl.window_rule({ match = { class = "^(org\\.gnome\\.TextEditor)$" }, float = true })
hl.window_rule({ match = { class = "^(org\\.gnome\\.Loupe)$" }, float = true })

-- Plexamp
hl.window_rule({ match = { class = "Plexamp" }, float = true })
hl.window_rule({ match = { class = "Plexamp" }, size = "360 620" })

-- Flatseal
hl.window_rule({ match = { class = "^(com\\.github\\.tchx84\\.Flatseal)$" }, float = true })

-- Font Viewer (GNOME)
hl.window_rule({ match = { class = "^(org\\.gnome\\.font-viewer)$" }, float = true })

-- Flake Update Terminal
hl.window_rule({ match = { class = "^(flake_update_terminal)$" }, float = true })
hl.window_rule({ match = { class = "^(flake_update_terminal)$" }, pin = true })

-- Wiremix Terminal
hl.window_rule({ match = { class = "^(wiremix_terminal)$" }, float = true })
hl.window_rule({ match = { class = "^(wiremix_terminal)$" }, pin = true })
hl.window_rule({ match = { class = "^(wiremix_terminal)$" }, no_anim = true })
hl.window_rule({ match = { class = "^(wiremix_terminal)$" }, size = "725 500" })
hl.window_rule({ match = { class = "^(wiremix_terminal)$" }, move = "(monitor_w-window_w-45) (monitor_h-window_h-50)" })

-- Nvitop Terminal
hl.window_rule({ match = { class = "^(nvitop_terminal)$" }, float = true })
hl.window_rule({ match = { class = "^(nvitop_terminal)$" }, pin = true })
hl.window_rule({ match = { class = "^(nvitop_terminal)$" }, no_anim = true })
hl.window_rule({ match = { class = "^(nvitop_terminal)$" }, size = "900 655" })
hl.window_rule({ match = { class = "^(nvitop_terminal)$" }, move = "(monitor_w-window_w-220) (monitor_h-window_h-205)" })

-- S-TUI Terminal
hl.window_rule({ match = { class = "^(s_tui_terminal)$" }, float = true })
hl.window_rule({ match = { class = "^(s_tui_terminal)$" }, pin = true })
hl.window_rule({ match = { class = "^(s_tui_terminal)$" }, no_anim = true })
hl.window_rule({ match = { class = "^(s_tui_terminal)$" }, size = "1200 760" })
hl.window_rule({ match = { class = "^(s_tui_terminal)$" }, move = "(monitor_w-window_w-520) (monitor_h-window_h-325)" })

-- BTOP CPU Terminal
hl.window_rule({ match = { class = "^(btop_cpu_terminal)$" }, float = true })
hl.window_rule({ match = { class = "^(btop_cpu_terminal)$" }, pin = true })
hl.window_rule({ match = { class = "^(btop_cpu_terminal)$" }, no_anim = true })
hl.window_rule({ match = { class = "^(btop_cpu_terminal)$" }, size = "920 620" })
hl.window_rule({ match = { class = "^(btop_cpu_terminal)$" }, move = "(monitor_w-window_w-230) (monitor_h-window_h-170)" })

-- BTOP Mem Terminal
hl.window_rule({ match = { class = "^(btop_mem_terminal)$" }, float = true })
hl.window_rule({ match = { class = "^(btop_mem_terminal)$" }, pin = true })
hl.window_rule({ match = { class = "^(btop_mem_terminal)$" }, no_anim = true })
hl.window_rule({ match = { class = "^(btop_mem_terminal)$" }, size = "920 620" })
hl.window_rule({ match = { class = "^(btop_mem_terminal)$" }, move = "(monitor_w-window_w-230) (monitor_h-window_h-170)" })

-- GCR Prompter
hl.window_rule({ match = { class = "^(gcr-prompter)$" }, pin = true })

-- Mullvad VPN
hl.window_rule({ match = { class = "^(Mullvad VPN)$" }, float = true })
hl.window_rule({ match = { class = "^(Mullvad VPN)$" }, pin = true })

-- Nemo File Manager
hl.window_rule({ match = { class = "^(nemo)$" }, float = true })
hl.window_rule({ match = { class = "^(nemo)$" }, no_anim = true })

-- File Roller
hl.window_rule({ match = { class = "^(org\\.gnome\\.FileRoller)$" }, float = true })

-- Network Manager Connection Editor
hl.window_rule({ match = { class = "^(nm-connection-editor)$" }, float = true })
hl.window_rule({ match = { class = "^(nm-connection-editor)$" }, pin = true })
hl.window_rule({ match = { class = "^(nm-connection-editor)$" }, no_anim = true })
hl.window_rule({ match = { class = "^(nm-connection-editor)$" }, move = "onscreen 100% 100%" })
hl.window_rule({ match = { class = "^(nm-connection-editor)$", initial_title = "^(Network Connections)$" }, size = "350 270" })

-- Proton VPN
hl.window_rule({ match = { class = "^(protonvpn-app)$" }, float = true })
hl.window_rule({ match = { class = "^(protonvpn-app)$" }, pin = true })
hl.window_rule({ match = { class = "^(protonvpn-app)$" }, move = "onscreen 100% 100%" })
hl.window_rule({ match = { class = "^(protonvpn\\.app)$", title = "^(Proton VPN)$" }, float = true })

-- Proton Mail
hl.window_rule({ match = { class = "^(chrome-mail\\.proton\\.me__-ProtonmailProfile)$" }, workspace = "2" })

-- Vicinae
hl.window_rule({ match = { initial_title = "^(Vicinae (Launcher|Settings))$" }, no_anim = true })
hl.window_rule({ match = { initial_title = "^(Vicinae (Launcher|Settings))$" }, border_size = 0 })
hl.window_rule({ match = { initial_title = "^(Vicinae (Launcher|Settings))$" }, rounding = 10 })
hl.window_rule({ match = { initial_title = "^(Vicinae (Launcher|Settings))$" }, no_shadow = false })

-- Warehouse (Flattool)
hl.window_rule({ match = { class = "^(io\\.github\\.flattool\\.Warehouse)$" }, float = true })
hl.window_rule({ match = { class = "^(io\\.github\\.flattool\\.Warehouse)$" }, size = "750 900" })

-- XDG Desktop Portal GTK (File Picker)
hl.window_rule({ match = { class = "^(xdg-desktop-portal-gtk)$" }, float = true })
hl.window_rule({ match = { class = "^(xdg-desktop-portal-gtk)$" }, pin = true })
hl.window_rule({ match = { class = "^(xdg-desktop-portal-gtk)$" }, no_anim = true })

-- Zen Browser
hl.window_rule({ match = { title = "^([Pp]icture-in-[Pp]icture)$" }, float = true })
hl.window_rule({ match = { title = "^([Pp]icture-in-[Pp]icture)$" }, no_initial_focus = true })
hl.window_rule({ match = { title = "^([Pp]icture-in-[Pp]icture)$" }, pin = true })
hl.window_rule({ match = { title = "([Pp]icture-in-[Pp]icture)" }, animation = "slide right" })
hl.window_rule({ match = { initial_title = "(^(Picture-in-Picture)$)" }, size = "688 388" })
hl.window_rule({ match = { initial_title = "(^(Picture-in-Picture)$)" }, move = "2739 993" })

-- Floorp Browser
hl.window_rule({ match = { class = "^(one\\.ablaze\\.floorp)$" }, monitor = "HDMI-A-2" })
hl.window_rule({ match = { class = "^(floorp)$" }, monitor = "HDMI-A-2" })

-- Winboat
hl.window_rule({ match = { class = "(winboat)" }, float = true })
hl.window_rule({ match = { initial_class = "^(winboat-⚙️ Windows Explorer)$" }, float = true })
hl.window_rule({ match = { initial_class = "^(winboat-Huetrofor Hue)$" }, float = true })
hl.window_rule({ match = { initial_class = "^(winboat-Huetrofor Hue)$" }, size = "1460 880" })
hl.window_rule({ match = { initial_class = "^(winboat-Huetrofor Hue)$" }, move = "3255 779" })

-- xfreerdp (FreeRDP)
hl.window_rule({ match = { initial_class = "^(xfreerdp)$" }, fullscreen = true })

-- MEGAsync
hl.window_rule({ match = { class = "nz.mega.MEGAsync" }, float = true })
hl.window_rule({ match = { initial_title = "^(MEGAsync)$" }, float = true })
hl.window_rule({ match = { initial_title = "^(MEGAsync)$" }, pin = true })
hl.window_rule({ match = { initial_title = "^(MEGAsync)$" }, rounding = 15 })
hl.window_rule({ match = { initial_class = "nz.co.mega" }, float = true })

-- Steam
hl.window_rule({ match = { initial_title = "^(Friends List)$" }, float = true })
hl.window_rule({ match = { initial_title = "^(Add Non-Steam Game)$" }, float = true })
hl.window_rule({ match = { initial_title = "^(Sign in to Steam)$" }, float = true })
hl.window_rule({ match = { initial_title = "^(Sign in to Steam)$" }, center = true })

-- Steam games
hl.window_rule({ match = { class = "^(steam_app_0)" }, no_anim = true })
hl.window_rule({ match = { class = "^(steam_app_0)" }, border_size = 0 })
hl.window_rule({ match = { class = "^(steam_app_0)" }, rounding = 0 })
hl.window_rule({ match = { class = "^(steam_app_0)" }, no_shadow = true })
hl.window_rule({ match = { class = "^(steam_app_0)" }, opacity = "1.0 override 1.0 override" })

-- SGDBoop
hl.window_rule({ match = { class = "^(SGDBoop)$" }, float = true })
hl.window_rule({ match = { class = "^(SGDBoop)$" }, pin = true })

-- Wine
hl.window_rule({ match = { class = "^(winecfg\\.exe)$" }, float = true })

-- Battle.net
hl.window_rule({ match = { initial_title = "^(Battle\\.net Login)$" }, workspace = "10 silent" })
hl.window_rule({ match = { initial_title = "^(Battle.net Login)$" }, no_anim = true })
hl.window_rule({ match = { initial_title = "^(Battle.net Login)$" }, rounding = 0 })
hl.window_rule({ match = { initial_title = "^(Battle.net Login)$" }, border_size = 0 })
hl.window_rule({ match = { initial_title = "^(Battle\\.net)$" }, workspace = "10 silent" })
hl.window_rule({ match = { initial_title = "^(Battle.net)$" }, no_anim = true })
hl.window_rule({ match = { initial_title = "^(Battle.net)$" }, rounding = 0 })
hl.window_rule({ match = { initial_title = "^(Battle.net)$" }, border_size = 0 })
hl.window_rule({ match = { initial_title = "^(Battle\\.net Settings)$" }, workspace = "10 silent" })
hl.window_rule({ match = { initial_title = "^(Battle.net Settings)$" }, no_anim = true })
hl.window_rule({ match = { initial_title = "^(Battle.net Settings)$" }, rounding = 0 })
hl.window_rule({ match = { initial_title = "^(Battle.net Settings)$" }, border_size = 0 })
hl.window_rule({ match = { initial_title = "^(Battle.net Settings)$" }, pin = true })

-- World of Warcraft
hl.window_rule({ match = { initial_title = "^(World of Warcraft)$" }, workspace = "10 silent" })
hl.window_rule({ match = { title = "^(World of Warcraft)$" }, workspace = "10 silent" })
hl.window_rule({ match = { initial_title = "^(World of Warcraft)$" }, no_anim = true })
hl.window_rule({ match = { title = "^(World of Warcraft)$" }, no_anim = true })
hl.window_rule({ match = { initial_title = "^(World of Warcraft)$" }, border_size = 0 })
hl.window_rule({ match = { title = "^(World of Warcraft)$" }, border_size = 0 })
hl.window_rule({ match = { initial_title = "^(World of Warcraft)$" }, rounding = 0 })
hl.window_rule({ match = { title = "^(World of Warcraft)$" }, rounding = 0 })
hl.window_rule({ match = { initial_title = "^(World of Warcraft)$" }, no_shadow = true })
hl.window_rule({ match = { title = "^(World of Warcraft)$" }, no_shadow = true })
hl.window_rule({ match = { initial_title = "^(World of Warcraft)$" }, opacity = "1.0 override 1.0 override" })
hl.window_rule({ match = { title = "^(World of Warcraft)$" }, opacity = "1.0 override 1.0 override" })

-- Zenity
hl.window_rule({ match = { initial_class = "^(zenity)$" }, float = true })
hl.window_rule({ match = { initial_class = "^(zenity)$" }, border_size = 0 })
hl.window_rule({ match = { initial_class = "^(zenity)$" }, rounding = 0 })
hl.window_rule({ match = { initial_class = "^(zenity)$" }, no_shadow = true })
hl.window_rule({ match = { class = "^(zenity)$" }, no_blur = true })
hl.window_rule({ match = { initial_class = "^(zenity)$" }, opacity = "1.0 override 1.0 override" })
