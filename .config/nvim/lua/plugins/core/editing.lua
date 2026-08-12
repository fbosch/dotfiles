local register = require("config.pack.registry").register

register({
	{
		name = "live-rename.nvim",
		src = "https://github.com/saecki/live-rename.nvim.git",
		keys = {
			{
				"<leader>rn",
				function()
					require("live-rename").rename({ insert = true, cursorpos = -1 })
				end,
				mode = "n",
				desc = "rename",
			},
		},
		setup = function()
			require("live-rename").setup({})
		end,
	},
	{
		name = "mini.ai",
		src = "https://github.com/echasnovski/mini.ai.git",
		opts = {},
	},
	{
		name = "nvim-toggler",
		src = "https://github.com/nguyenvukhang/nvim-toggler.git",
		opts = {},
	},
	{
		name = "nvim-surround",
		src = "https://github.com/kylechui/nvim-surround.git",
		version = "^3.0.0",
		opts = {},
	},
	{
		name = "nvim-spider",
		src = "https://github.com/chrisgrieser/nvim-spider.git",
		events = { "BufEnter" },
		setup = function()
			-- Ex-command mappings preserve Spider's operator and dot-repeat behavior.
			for _, motion in ipairs({ "w", "e", "b" }) do
				vim.keymap.set(
					{ "n", "o", "x" },
					motion,
					("<cmd>lua require('spider').motion('%s')<CR>"):format(motion)
				)
			end
		end,
	},
	{
		name = "ts-comments.nvim",
		src = "https://github.com/folke/ts-comments.nvim.git",
		module = "ts-comments",
		opts = {},
	},
	{
		name = "nvim-autopairs",
		src = "https://github.com/windwp/nvim-autopairs.git",
		events = { "InsertEnter" },
		opts = {},
	},
	{
		name = "vim-repeat",
		src = "https://github.com/tpope/vim-repeat.git",
		events = { "BufEnter" },
	},
})

return {
	{ "tpope/vim-unimpaired", keys = { "]", "[" } },
	{ "monkoose/matchparen.nvim", event = { "InsertEnter" }, opts = {} },
	{
		"tpope/vim-abolish",
		event = "InsertEnter",
		config = require("config.abbr").autofix_typos,
	},
}
