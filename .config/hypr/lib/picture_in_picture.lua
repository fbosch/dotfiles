local M = {
	class = "app.zen_browser.zen",
	title = "Picture-in-Picture",
	right_margin = 15,
	bottom_margin = 15,
	overlap_gap = 15,
}

M.normal_move = string.format("(monitor_w-window_w-%d) (monitor_h-window_h-%d)", M.right_margin, M.bottom_margin)

return M
