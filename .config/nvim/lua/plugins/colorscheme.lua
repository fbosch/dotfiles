return {
	"mcchrish/zenbones.nvim",
	dependencies = { "rktjmp/lush.nvim" },
	priority = 1337,
	config = function()
		vim.cmd([[colorscheme zenwritten]])

		vim.api.nvim_set_hl(0, "NotifyBackground", { bg = "#191919" })
		vim.api.nvim_set_hl(0, "TreesitterContext", { bg = "#2c2c2c" })
		vim.api.nvim_set_hl(0, "SpellBad", { undercurl = true, sp = "#A8334C" })
		vim.api.nvim_set_hl(0, "MatchParen", { fg = "#252525", bg = "#6e8aa5" })

		-- popup menu highlights (wilder, telescope, etc.)
		vim.api.nvim_set_hl(0, "NormalFloat", { bg = "#191919" })
		vim.api.nvim_set_hl(0, "Pmenu", { bg = "#191919" })
		vim.api.nvim_set_hl(0, "Beacon", { bg = "#bbbbbb", ctermbg = 15 })

		-- notify
		vim.api.nvim_set_hl(0, "NotifyERRORBorder", { fg = "#DE6E7C" })
		vim.api.nvim_set_hl(0, "NotifyWARNBorder", { fg = "#D68C67" })
		vim.api.nvim_set_hl(0, "NotifyINFOBorder", { fg = "#2c2c2c" })
		vim.api.nvim_set_hl(0, "NotifyDEBUGBorder", { fg = "#aaaaaa" })
		vim.api.nvim_set_hl(0, "NotifyTRACEBorder", { fg = "#b279a7" })
		vim.api.nvim_set_hl(0, "NotifyERRORIcon", { fg = "#DE6E7C" })
		vim.api.nvim_set_hl(0, "NotifyWARNIcon", { fg = "#D68C67" })
		vim.api.nvim_set_hl(0, "NotifyINFOIcon", { fg = "#97bdde" })
		vim.api.nvim_set_hl(0, "NotifyDEBUGIcon", { fg = "#aaaaaa" })
		vim.api.nvim_set_hl(0, "NotifyTRACEIcon", { fg = "#b279a7" })
		vim.api.nvim_set_hl(0, "NotifyERRORTitle", { fg = "#DE6E7C" })
		vim.api.nvim_set_hl(0, "NotifyWARNTitle", { fg = "#D68C67" })
		vim.api.nvim_set_hl(0, "NotifyINFOTitle", { fg = "#bbbbbb" })
		vim.api.nvim_set_hl(0, "NotifyDEBUGTitle", { fg = "#aaaaaa" })
		vim.api.nvim_set_hl(0, "NotifyTRACETitle", { fg = "#b279a7" })

		-- fold
		vim.api.nvim_set_hl(0, "Folded", { fg = "#bbbbbb", bg = "#252525" })
	end,
}
