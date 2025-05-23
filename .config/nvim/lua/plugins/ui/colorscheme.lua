return {
	"mcchrish/zenbones.nvim",
	dependencies = { "rktjmp/lush.nvim" },
	priority = 10000,
	event = "VeryLazy",
	config = function()
		vim.g.zenbones_solid_line_nr = true

		-- undercurl
		vim.cmd([[let &t_Cs = "\e[4:3m"]])
		vim.cmd([[let &t_Ce = "\e[4:0m"]])

		vim.cmd([[colorscheme zenwritten]])

		local colors = require("config.colors")
		local hl = vim.api.nvim_set_hl

		hl(0, "LocalHighlight", { bg = colors.gray })

		hl(0, "NotifyBackground", { bg = colors.background })
		hl(0, "TreesitterContext", { bg = colors.dark_gray })
		hl(0, "SpellBad", { undercurl = true, sp = colors.mispell_red })
		hl(0, "MatchParen", { fg = colors.darker_gray, bg = colors.match_blue })

		hl(0, "IncSearch", { bg = colors.purple, fg = colors.darker_gray, bold = true })
		hl(0, "Substitute", { bg = colors.orange, fg = colors.darker_gray })

		-- popup menu highlights (wilder, telescope, etc.)
		local border_color = { fg = colors.light_gray }
		hl(0, "NormalFloat", { bg = colors.background })
		hl(0, "FloatBorder", border_color)
		hl(0, "LspInfoBorder", border_color)
		hl(0, "FzfLuaBorder", border_color)
		hl(0, "NormalFloatBorder", border_color)
		hl(0, "Pmenu", { bg = colors.background })
		hl(0, "Beacon", { bg = colors.lighter_gray, ctermbg = 15 })

		-- notify
		hl(0, "NotifyERRORBorder", { fg = colors.red })
		hl(0, "NotifyWARNBorder", { fg = colors.orange })
		hl(0, "NotifyINFOBorder", { fg = colors.dark_gray })
		hl(0, "NotifyDEBUGBorder", { fg = colors.lighter_gray })
		hl(0, "NotifyTRACEBorder", { fg = colors.purple })
		hl(0, "NotifyERRORIcon", { fg = colors.red })
		hl(0, "NotifyWARNIcon", { fg = colors.orange })
		hl(0, "NotifyINFOIcon", { fg = colors.blue })
		hl(0, "NotifyDEBUGIcon", { fg = colors.lighter_gray })
		hl(0, "NotifyTRACEIcon", { fg = colors.purple })
		hl(0, "NotifyERRORTitle", { fg = colors.red })
		hl(0, "NotifyWARNTitle", { fg = colors.orange })
		hl(0, "NotifyINFOTitle", { fg = colors.lighter_gray })
		hl(0, "NotifyDEBUGTitle", { fg = colors.lighter_gray })
		hl(0, "NotifyTRACETitle", { fg = colors.purple })

		-- fold
		hl(0, "Folded", { fg = colors.lighter_gray, bg = colors.darker_gray })

		-- indent
		hl(0, "IndentBlanklineScope", { fg = colors.match_blue })
		hl(0, "IblScope", { fg = colors.match_blue })

		-- treesitter
		hl(0, "TreesitterContext", { bg = colors.darkest_gray })
		hl(0, "TreesitterContextLineNumber", { bg = colors.darkest_gray })
		hl(0, "TreesitterContextBottom", { bg = colors.darkest_gray, underline = true, sp = colors.dark_gray })

		-- leap
		hl(0, "LeapMatch", { fg = colors.blue, underline = true })
		hl(0, "LeapLabelPrimary", { fg = colors.purple, underline = true })
		hl(0, "LeapBackdrop", { fg = colors.search_backdrop })

		-- gitsigns
		hl(0, "GitSignsAdded", { fg = colors.green })
		hl(0, "GitSignsChanged", { fg = colors.yellow })
		hl(0, "GitSignsRemoved", { fg = colors.red })
	end,
}
