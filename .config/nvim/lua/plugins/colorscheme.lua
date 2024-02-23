return {
	"mcchrish/zenbones.nvim",
	dependencies = { "rktjmp/lush.nvim" },
	priority = 10000,
	event = "VeryLazy",
	config = function()
		vim.g.zenbones_solid_line_nr = true

		vim.cmd([[colorscheme zenwritten]])

		local colors = require("colors")
		local hl = vim.api.nvim_set_hl

		hl(0, "NotifyBackground", { bg = colors.background })
		hl(0, "TreesitterContext", { bg = colors.dark_gray })
		hl(0, "SpellBad", { undercurl = true, sp = colors.mispell_red })
		hl(0, "MatchParen", { fg = colors.darker_gray, bg = colors.match_blue })

		-- popup menu highlights (wilder, telescope, etc.)
		hl(0, "NormalFloat", { bg = colors.background })
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
	end,
}
