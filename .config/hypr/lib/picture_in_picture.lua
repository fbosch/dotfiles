local M = {
	class = "app.zen_browser.zen",
	title = "Picture-in-Picture",
	margin = 15,
	overlap_gap = 15,
	snap_vicinity = 100,
	rounding = 8,
	default_animation = "slide left",
	corners = {
		["top-left"] = { tag = "pip-top-left", animation = "slide right" },
		["top-right"] = { tag = "pip-top-right", animation = "slide left" },
		["bottom-left"] = { tag = "pip-bottom-left", animation = "slide right" },
		["bottom-right"] = { tag = "pip-bottom-right", animation = "slide left" },
	},
}

M.corner_tag_animations = {}
for _, corner in pairs(M.corners) do
	M.corner_tag_animations[corner.tag] = corner.animation
end

M.normal_move = string.format("(monitor_w-window_w-%d) (monitor_h-window_h-%d)", M.margin, M.margin)

function M.register_window_rules()
	hl.window_rule({
		match = { title = "^([Pp]icture-in-[Pp]icture)$" },
		float = true,
		no_initial_focus = true,
		pin = true,
		content = "video",
		persistent_size = true,
		rounding = M.rounding,
	})
	hl.window_rule({ match = { title = "([Pp]icture-in-[Pp]icture)" }, animation = M.default_animation })
	for _, corner in pairs(M.corners) do
		hl.window_rule({ match = { tag = corner.tag }, animation = corner.animation })
	end
	hl.window_rule({
		match = { initial_title = "(^(Picture-in-Picture)$)" },
		move = M.normal_move,
	})
end

return M
