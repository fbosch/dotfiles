local M = {
	class = "app.zen_browser.zen",
	title = "Picture-in-Picture",
	margin = 15,
	overlap_gap = 15,
	snap_vicinity = 50,
}

M.normal_move = string.format("(monitor_w-window_w-%d) (monitor_h-window_h-%d)", M.margin, M.margin)

return M
