return {
	"utilyre/barbecue.nvim",
	dependencies = {
		"SmiteshP/nvim-navic",
		"kyazdani42/nvim-web-devicons",
	},
	event = "ColorScheme",
	enabled = false,
	config = function()
		local colors = require("colors")
		local barbecue = require("barbecue")
		barbecue.setup({
			create_autocmd = true,
			show_basename = false,
			show_dirname = false,
			show_modified = false,
			show_navic = true,
			theme = {
				normal = { bg = colors.background, fg = colors.lighter_gray },
				basename = { bold = true },
				separator = { fg = colors.light_gray },
				modified = { fg = colors.orange },
				-- context
				context_module = { fg = colors.purple },
				context_constant = { fg = colors.light_gray },
				context_namespace = { fg = colors.blue },
				context_function = { fg = colors.purple },
				context_method = { fg = colors.purple },
				context_type_parameter = { fg = colors.purple },
				context_variable = { fg = colors.blue },
				context_field = { fg = colors.white },
				context_property = { fg = colors.white },
			},
		})
	end,
}
