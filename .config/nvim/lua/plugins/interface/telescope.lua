return {
	"nvim-telescope/telescope.nvim",
	dependencies = {
		"stevearc/dressing.nvim",
	},
	cmd = { "Telescope" },
	config = function()
		local telescope = require("telescope")
		telescope.setup({
			defaults = {
				layout_config = {
					width = 0.4,
					height = 0.4,
					scroll_speed = 1.5,
					preview_cutoff = 400,
				},
			},
		})
	end,
}
