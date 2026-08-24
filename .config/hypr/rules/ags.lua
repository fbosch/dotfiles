local window_tags = require("lib.window_tags")

local M = {}

function M.register()
	hl.window_rule({
		match = { class = "^(io\\.Astal\\.ags-bundled)$" },
		float = true,
		pin = true,
		border_size = 0,
		rounding = 12,
		tag = "+" .. window_tags.passthrough_exempt,
	})
	hl.window_rule({
		match = { title = "^(Force Quit Applications)$" },
		center = true,
		size = "462 534",
		min_size = "462 534",
		max_size = "462 534",
		tag = "+" .. window_tags.non_resizable,
	})
	hl.window_rule({
		match = { title = "^(About This PC)$" },
		center = true,
		size = "422 562",
		min_size = "422 562",
		max_size = "422 562",
		border_size = 1,
		rounding = 12,
		tag = "+" .. window_tags.non_resizable,
	})
	hl.window_rule({ match = { class = "^(flake_update_terminal)$" }, float = true, pin = true })
	hl.window_rule({
		match = { class = "^(about_this_pc_more_info)$" },
		float = true,
		pin = true,
		center = true,
		size = "968 666",
	})
end

return M
