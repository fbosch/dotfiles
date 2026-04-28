-- Static workspace rules ported from rules.conf.
-- Preserve declaration order.

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
  workspace = "2",
  monitor = "HDMI-A-2",
  layout = "master",
  layout_opts = { orientation = "bottom" },
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
