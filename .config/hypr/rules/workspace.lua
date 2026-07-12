-- Static workspace rules ported from hyprland.conf and rules.conf.
-- Preserve declaration order.
-- Use built-in layouts here for native mouse resize and cross-monitor moves.
-- Count-based selectors only match existing windows, so keep a broad baseline
-- before the count-specific overrides for deterministic startup behavior.

local system = require("lib.system")
local host = system.hostname()

if host == "rvn-pc" then
	hl.workspace_rule({
		workspace = "1",
		monitor = "HDMI-A-2",
		layout = "lua:portrait_rows",
		default = true,
	})

	hl.workspace_rule({
		workspace = "10",
		monitor = "DP-2",
	})

	hl.workspace_rule({
		workspace = "2",
		monitor = "DP-2",
		layout = "lua:ultrawide_master",
		default = true,
	})

	hl.workspace_rule({
		workspace = "r[1-9] m[DP-2]",
		layout = "lua:ultrawide_master",
	})

	hl.workspace_rule({
		workspace = "r[1-9] m[HDMI-A-2]",
		layout = "lua:portrait_rows",
	})

	hl.workspace_rule({
		workspace = "r[1-9] m[DP-2] w[tv2]",
		layout = "lua:ultrawide_master",
	})

	hl.workspace_rule({
		workspace = "r[1-9] m[DP-2] w[tv3]",
		layout = "lua:ultrawide_master",
	})

	hl.workspace_rule({
		workspace = "10",
		layout = "scrolling",
		gaps_in = 0,
		gaps_out = 0,
	})

	hl.workspace_rule({
		workspace = "special:gaming-overlay",
		gaps_in = 0,
		gaps_out = 0,
	})
end
