-- Static layer rules ported from appearance.conf.
-- Preserve declaration order.

hl.layer_rule({ match = { namespace = "waybar" }, blur = true, ignore_alpha = 0.3 })
hl.layer_rule({ match = { namespace = "vicinae" }, blur = true, no_anim = true, ignore_alpha = 0 })
hl.layer_rule({ match = { namespace = "rofi" }, blur = true })
hl.layer_rule({ match = { namespace = "nemo" }, blur = true })
hl.layer_rule({ match = { namespace = "rofi" }, ignore_alpha = 0 })
hl.layer_rule({ match = { namespace = "swaync-control-center" }, blur = true, no_anim = true, ignore_alpha = 0.3 })
hl.layer_rule({ match = { namespace = "swaync-notification-window" }, blur = true, no_anim = true, ignore_alpha = 0.3 })
hl.layer_rule({ match = { namespace = "swayosd" }, blur = true, ignore_alpha = 0.3 })
hl.layer_rule({ match = { namespace = "ags-confirm" }, blur = true, animation = "popin 90%", ignore_alpha = 0.5 })
hl.layer_rule({ match = { namespace = "ags-layout-switcher" }, blur = true, no_anim = true, ignore_alpha = 0.3 })
hl.layer_rule({ match = { namespace = "ags-volume-indicator" }, blur = true, no_anim = true, ignore_alpha = 0.3 })
hl.layer_rule({ match = { namespace = "ags-window-switcher" }, blur = true, no_anim = true, ignore_alpha = 0.3 })
hl.layer_rule({ match = { namespace = "ags-start-menu" }, blur = true, no_anim = true, ignore_alpha = 0.3 })
hl.layer_rule({ match = { namespace = "ags-calendar-widget" }, blur = true, no_anim = true, ignore_alpha = 0.3 })
hl.layer_rule({ match = { namespace = "ags-desktop-clock" }, blur = true, ignore_alpha = 0.3, no_anim = true })
hl.layer_rule({
	match = { namespace = "hyprshutdown" },
	blur = true,
	ignore_alpha = 0.2,
	dim_around = true,
	animation = "popin 96%",
})
