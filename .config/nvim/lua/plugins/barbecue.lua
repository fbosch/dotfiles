return {
	"utilyre/barbecue.nvim",
	dependencies = {
		"SmiteshP/nvim-navic",
		"kyazdani42/nvim-web-devicons",
	},
	event = "ColorScheme",
	config = function()
		local barbecue = require("barbecue")
		barbecue.setup({
			create_autocmd = true,
			show_basename = false,
			show_dirname = false,
			show_modified = true,
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
		-- vim.api.nvim_create_autocmd({
		-- 	"WinScrolled", -- or WinResized on NVIM-v0.9 and higher
		-- 	"WinResized",
		-- 	"BufWinEnter",
		-- 	"CursorHold",
		-- 	"InsertLeave",
		-- 	-- include these if you have set `show_modified` to `true`
		-- 	"BufWritePost",
		-- 	"TextChanged",
		-- 	"TextChangedI",
		-- }, {
		-- 	group = vim.api.nvim_create_augroup("barbecue.updater", {}),
		-- 	callback = function()
		-- 		require("barbecue.ui").update()
		-- 	end,
		-- })
	end,
}
