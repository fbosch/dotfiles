return {
	"numtostr/FTerm.nvim",
	cmd = { "FTermOpen", "FTermClose", "FTermExit", "FTermToggle" },
	keys = {
		{
			"<A-t>",
			"<cmd>FTermToggle<cr>",
			desc = "toggle floating terminal",
			mode = "n",
			silent = true,
		},
		{
			"<A-t>",
			"<C-\\><C-n><cmd>FTermToggle<cr>",
			desc = "toggle floating terminal",
			mode = "t",
			silent = true,
		},
	},
	config = function()
		require("FTerm").setup({
			border = "rounded",
			env = {
				["IN_NEOVIM"] = "1",
			},
			dimensions = {
				height = 0.85,
				width = 0.85,
			},
		})
		vim.api.nvim_create_user_command("FTermOpen", require("FTerm").open, { bang = true })
		vim.api.nvim_create_user_command("FTermClose", require("FTerm").close, { bang = true })
		vim.api.nvim_create_user_command("FTermExit", require("FTerm").exit, { bang = true })
		vim.api.nvim_create_user_command("FTermToggle", require("FTerm").toggle, { bang = true })
	end,
}
