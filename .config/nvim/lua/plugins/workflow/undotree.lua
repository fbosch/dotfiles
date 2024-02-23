return {
	"mbbill/undotree",
	cmd = { "UndotreeToggle", "UndotreeShow", "UndotreeHide" },
	keys = {
		{
			mode = { "n" },
			"<leader>uu",
			"<cmd>UndotreeToggle<cr>",
			desc = "undotree toggle",
		},
	},
	config = function()
		vim.g.undotree_WindowLayout = 2
	end,
}
