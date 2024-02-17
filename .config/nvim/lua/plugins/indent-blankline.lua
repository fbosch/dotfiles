return {
	"lukas-reineke/indent-blankline.nvim",
	event = "VeryLazy",
	priority = 100,
	config = function()
		require("ibl").setup({
			indent = { char = "▏" },
			scope = {
				char = "▏",
				enabled = true,
			},
		})
	end,
}
