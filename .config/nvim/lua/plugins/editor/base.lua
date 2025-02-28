return {
	{ "tpope/vim-repeat", event = "BufRead" },
	{ "smjonas/inc-rename.nvim", event = "BufRead", opts = {} },
	{ "windwp/nvim-autopairs", event = { "InsertEnter" }, opts = {} },
	{ "monkoose/matchparen.nvim", event = { "InsertEnter" }, opts = {} },
	{ "folke/ts-comments.nvim", event = "BufRead", opts = {} },
	{ "echasnovski/mini.surround", event = { "InsertEnter" }, opts = {} },
	{ "smjonas/live-command.nvim", event = "BufRead", opts = {} },
	{ "nguyenvukhang/nvim-toggler", event = { "BufReadPost" }, opts = {} },
	{
		"chrisgrieser/nvim-recorder",
		dependencies = "rcarriga/nvim-notify", -- optional
		opts = {}, -- required even with default settings, since it calls `setup()`
	},
	{

		"caliguIa/zendiagram.nvim",
		event = "BufRead",
		enabled = false,
		keys = {
			{
				"<leader>zd",
				"<cmd>lua require('zendiagram').open()<cr>",
				mode = { "n" },
			},
		},
		config = function()
			require("zendiagram").setup({
				-- Below are the default values
				header = "Diagnostics", -- Header text
				max_width = 50, -- The maximum width of the float window
				min_width = 25, -- The minimum width of the float window
				max_height = 10, -- The maximum height of the float window
				border = "single", -- Border style. Can be single, double, rounded, solid, shadow.
				position = {
					row = 3, -- The offset from the top of the screen
					col_offset = 2, -- The offset from the right of the screen
				},
				highlights = { -- Highlight groups for each section of the float
					ZendiagramHeader = "Error", -- Accepts a highlight group name or a table of highlight group opts
					ZendiagramSeparator = "NonText",
					ZendiagramText = "Normal",
					ZendiagramKeyword = "Keyword",
				},
			})
		end,
	},
	{
		"cshuaimin/ssr.nvim",
		opts = {
			adjust_window = true,
		},
		keys = {
			{
				"<leader>sr",
				"<cmd>lua require('ssr').open()<cr>",
				mode = { "n", "v" },
			},
		},
	},
	{
		-- find and replace
		"ray-x/sad.nvim",
		dependencies = { "ray-x/guihua.lua", run = "cd lua/fzy && make" },
		keys = { {
			"<leader>ra",
			"<cmd>Sad<cr>",
			mode = { "n" },
		} },
		cmd = { "Sad" },
		opts = {},
		enabled = true,
	},
	{
		-- json editing tools
		"gennaro-tedesco/nvim-jqx",
		ft = { "json", "yaml" },
		event = "BufWritePost",
	},
	{
		"MaximilianLloyd/tw-values.nvim",
		cmd = "TWValues",
		ft = { "typescript", "typescriptreact", "javascript", "javascriptreact" },
		keys = {
			{
				mode = "n",
				"<leader>tw",
				"<cmd>TWValues<cr>",
				desc = "tailwind values",
			},
		},
	},
	{
		"chrisgrieser/nvim-spider",
		keys = {
			{
				"w",
				"<cmd>lua require('spider').motion('w')<CR>",
				mode = { "n", "o", "x" },
			},
			{
				"e",
				"<cmd>lua require('spider').motion('e')<CR>",
				mode = { "n", "o", "x" },
			},
			{
				"b",
				"<cmd>lua require('spider').motion('b')<CR>",
				mode = { "n", "o", "x" },
			},
		},
	},
}
