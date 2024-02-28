return {
	"utilyre/barbecue.nvim",
	dependencies = {
		"SmiteshP/nvim-navic",
		"kyazdani42/nvim-web-devicons",
	},
	event = "LspAttach",
  enabled = false,
	config = function()
		local colors = require("colors")
		local barbecue = require("barbecue")
		barbecue.setup({
			create_autocmd = true,
			show_basename = false,
			show_dirname = false,
			show_modified = true,
			show_navic = true,
			theme = {
				normal = { bg = colors.darkest_gray, fg = "#999999" },
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
