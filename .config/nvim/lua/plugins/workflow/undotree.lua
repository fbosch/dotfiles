return {
	"mbbill/undotree",
	cmd = { "UndotreeToggle", "UndotreeShow", "UndotreeHide" },
	keys = {
		{
			"<leader>uu",
			"<cmd>UndotreeToggle<cr>",
			desc = "undotree toggle",
			mode = { "n" },
			silent = true,
		},
	},
	config = function()
		vim.g.undotree_WindowLayout = 2
	end,
}
