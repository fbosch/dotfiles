return {
	"lukas-reineke/indent-blankline.nvim",
	-- version = "v2.20.8",
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
