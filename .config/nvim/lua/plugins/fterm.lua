return {
	"numtostr/FTerm.nvim",
	cmd = { "FTermOpen", "FTermClose", "FTermExit", "FTermToggle" },
	config = function()
		require("FTerm").setup({
			border = "rounded",
		})
		vim.api.nvim_create_user_command("FTermOpen", require("FTerm").open, { bang = true })
		vim.api.nvim_create_user_command("FTermClose", require("FTerm").close, { bang = true })
		vim.api.nvim_create_user_command("FTermExit", require("FTerm").exit, { bang = true })
		vim.api.nvim_create_user_command("FTermToggle", require("FTerm").toggle, { bang = true })
	end,
}
