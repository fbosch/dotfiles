return {
	"utilyre/barbecue.nvim",
	dependencies = {
		"SmiteshP/nvim-navic",
		"kyazdani42/nvim-web-devicons",
	},
	event = "ColorScheme",
	enabled = false,
	config = function()
		local barbecue = require("barbecue")
		barbecue.setup({
			create_autocmd = true,
			show_basename = false,
			show_dirname = false,
			show_modified = false,
			show_navic = true,
			theme = {
				normal = { bg = "#191919", fg = "#aaaaaa" },
				basename = { bold = true },
				separator = { fg = "#636363" },
				modified = { fg = "#D68C67" },
				-- context
				context_module = { fg = "#b279a7" },
				context_constant = { fg = "#636363" },
				context_namespace = { fg = "#97bdde" },
				context_function = { fg = "#b279a7" },
				context_method = { fg = "#b279a7" },
				context_type_parameter = { fg = "#b279a7" },
				context_variable = { fg = "#97bdde" },
				context_field = { fg = "#ffffff" },
				context_property = { fg = "#ffffff" },
			},
		})
	end,
}
