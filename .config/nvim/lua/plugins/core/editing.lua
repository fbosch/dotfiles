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
		version = vim.version.range("^3.0.0"),
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
	{
		name = "vim-abolish",
		src = "https://github.com/tpope/vim-abolish.git",
		events = { "InsertEnter" },
		setup = require("config.abbr").autofix_typos,
	},
	{
		name = "vim-unimpaired",
		src = "https://github.com/tpope/vim-unimpaired.git",
		startup = true,
	},
	{
		name = "matchparen.nvim",
		src = "https://github.com/monkoose/matchparen.nvim.git",
		events = { "InsertEnter" },
		setup = function(context)
			require("matchparen").setup({})
			-- The activating InsertEnter predates the plugin's own autocmd.
			if vim.v.insertmode ~= "i" then
				return
			end
			require("matchparen.options").opts.in_insert = true
			require("matchparen.highlight").update(context.buf)
		end,
	},
})
