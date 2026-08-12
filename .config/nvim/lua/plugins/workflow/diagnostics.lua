return {
	{
		"folke/trouble.nvim",
		dependencies = { "nvim-tree/nvim-web-devicons" },
		cmd = { "TroubleToggle", "Trouble", "TodoTrouble", "TroubleClose" },
		config = function()
			require("trouble").setup()
		end,
	},
	{
		"andythigpen/nvim-coverage",
		version = "*",
		dependencies = { "nvim-lua/plenary.nvim" },
		cmd = {
			"Coverage",
			"CoverageLoad",
			"CoverageLoadLcov",
			"CoverageShow",
			"CoverageHide",
			"CoverageToggle",
			"CoverageClear",
			"CoverageSummary",
		},
		keys = {
			{ "<leader>cc", "<cmd>Coverage<cr>", desc = "Toggle coverage display" },
			{ "<leader>cs", "<cmd>CoverageSummary<cr>", desc = "Coverage summary" },
			{ "<leader>cl", "<cmd>CoverageLoad<cr>", desc = "Load coverage" },
		},
		config = function()
			require("coverage").setup({
				auto_reload = true,
			})
		end,
	},
}
