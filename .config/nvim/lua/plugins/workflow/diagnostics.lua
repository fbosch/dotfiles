local register = require("config.pack.registry").register

register({
	name = "nvim-coverage",
	src = "https://github.com/andythigpen/nvim-coverage.git",
	dependencies = { "plenary.nvim" },
	module = "coverage",
	commands = {
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
		{
			"<leader>cc",
			function()
				vim.cmd("Coverage")
			end,
			desc = "Toggle coverage display",
		},
		{
			"<leader>cs",
			function()
				vim.cmd("CoverageSummary")
			end,
			desc = "Coverage summary",
		},
		{
			"<leader>cl",
			function()
				vim.cmd("CoverageLoad")
			end,
			desc = "Load coverage",
		},
	},
	opts = {
		auto_reload = true,
	},
})

return {
	{
		"folke/trouble.nvim",
		dependencies = { "nvim-tree/nvim-web-devicons" },
		cmd = { "TroubleToggle", "Trouble", "TodoTrouble", "TroubleClose" },
		config = function()
			require("trouble").setup()
		end,
	},
}
