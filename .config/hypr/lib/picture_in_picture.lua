local M = {
	class = "app.zen_browser.zen",
	title = "Picture-in-Picture",
	margin = 15,
	overlap_gap = 15,
	snap_vicinity = 100,
	rounding = 4,
	default_animation = "slide right",
	corners = {
		["top-left"] = { tag = "pip-top-left", animation = "slide left" },
		["top-right"] = { tag = "pip-top-right", animation = "slide right" },
		["bottom-left"] = { tag = "pip-bottom-left", animation = "slide left" },
		["bottom-right"] = { tag = "pip-bottom-right", animation = "slide right" },
	},
}

M.normal_move = string.format("(monitor_w-window_w-%d) (monitor_h-window_h-%d)", M.margin, M.margin)

function M.register_window_rules()
	hl.window_rule({
		match = { title = "^([Pp]icture-in-[Pp]icture)$" },
		float = true,
		no_initial_focus = true,
		pin = true,
		content = "video",
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
