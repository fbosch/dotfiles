return {
	{
		"RRethy/vim-hexokinase",
		build = "make hexokinase",
		enabled = false,
		init = function()
			vim.g.Hexokinase_highlighters = { "sign_column" }
			vim.g.Hexokinase_optInPatterns = "full_hex,rgb,rgba,hsl,hsla"
			vim.g.Hexokinase_ftEnabled = {
				"typescript",
				"typescriptreact",
				"javascript",
				"javascriptreact",
				"html",
				"vue",
				"svelte",
				"scss",
				"css",
				"less",
				"lua",
			}
		end,
	},
	{
		"max397574/colortils.nvim",
		cmd = "Colortils",
		enabled = false,
		keys = {
			{
				mode = "n",
				"<leader>pc",
				"<cmd>Colortils<cr>",
				desc = "pick color",
			},
		},
		config = function()
			local colors = require("colors")
			require("colortils").setup({
				background = colors.background,
			})
			vim.api.nvim_set_hl(0, "ColortilsCurrentLine", { fg = colors.purple })
		end,
	},
	{
		"uga-rosa/ccc.nvim",
		event = { "BufReadPost" },
		enabled = true,
		keys = {
			{
				mode = "n",
				"<leader>pc",
				"<cmd>CccPick<cr>",
				desc = "pick color",
				silent = true,
			},
		},
		config = function()
			local ccc = require("ccc")
			ccc.setup({
				highlighter = {
					highlight_mode = "fg",
					auto_enable = true,
				},
			})
		end,
	},
}
