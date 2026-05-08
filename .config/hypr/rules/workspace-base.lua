-- Workspace rules ported from hyprland.conf.
-- These load before rules.conf equivalents to preserve live declaration order.

hl.workspace_rule({
	workspace = "1",
	monitor = "HDMI-A-2",
})

hl.workspace_rule({
	workspace = "10",
	monitor = "DP-2",
})

hl.workspace_rule({
	workspace = "2",
	monitor = "DP-2",
	default = true,
})
