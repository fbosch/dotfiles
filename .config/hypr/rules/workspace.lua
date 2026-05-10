-- Static workspace rules ported from rules.conf.
-- Preserve declaration order.
-- Use built-in master presets here rather than custom Lua layouts; custom layouts
-- would need to reimplement master focus, resize, and layout message behavior.
-- Count-based selectors only match existing windows, so keep a broad baseline
-- before the count-specific overrides for deterministic startup behavior.

hl.workspace_rule({
	workspace = "r[1-9] m[DP-2]",
	layout = "master",
	layout_opts = { orientation = "left", mfact = 0.7 },
})

hl.workspace_rule({
	workspace = "r[1-9] m[HDMI-A-2]",
	layout = "lua:portrait_stack",
})

hl.workspace_rule({
	workspace = "r[1-9] m[DP-2] w[tv2]",
	layout = "master",
	layout_opts = { orientation = "left", mfact = 0.7 },
})

hl.workspace_rule({
	workspace = "r[1-9] m[DP-2] w[tv3]",
	layout = "master",
	layout_opts = { orientation = "center", mfact = 0.25 },
})

hl.workspace_rule({
	workspace = "10",
	layout = "scrolling",
})

hl.workspace_rule({
	workspace = "special:gaming-overlay",
	gaps_in = 0,
	gaps_out = 0,
})
