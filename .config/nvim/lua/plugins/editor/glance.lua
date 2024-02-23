return {
	"DNLHC/glance.nvim",
	cmd = { "Glance" },
	keys = {
		{
			mode = "n",
			"gD",
			"<cmd>Glance definitions<cr>",
			desc = "Glance at definitions",
		},
		{
			mode = "n",
			"gT",
			"<cmd>Glance type definitions<cr>",
			desc = "Glance at type definitions",
		},
		{
			mode = "n",
			"gR",
			"<cmd>Glance references<cr>",
			desc = "Glance at references",
		},
		{
			mode = "n",
			"gI",
			"<cmd>Glance implementations<cr>",
			desc = "Glance at implementations",
		},
	},
	config = function()
		require("glance").setup({
			height = 15,
			border = {
				enable = false,
			},
		})
	end,
}
