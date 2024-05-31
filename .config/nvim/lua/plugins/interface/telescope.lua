return {
	"nvim-telescope/telescope.nvim",
	dependencies = {
		"stevearc/dressing.nvim",
	},
	cmd = { "Telescope" },
	config = function()
		local dressing = require("dressing")
		dressing.setup({
			input = {
				insert_only = false,
			},
			select = {
				enabled = true,
				backend = { "fzf_lua", "fzf", "builtin", "nui" },
				trim_prompt = true,
			},
		})
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
