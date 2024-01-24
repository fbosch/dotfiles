return {
	"lukas-reineke/indent-blankline.nvim",
	-- version = "v2.20.8",
	event = "VeryLazy",
	config = function()
		vim.opt.list = true
		require("ibl").setup({
			indent = { char = "▎" },
			scope = {
				char = "▎",
				enabled = true,
				highlight = "IndentBlanklineScope",
			},
		})
		-- require("indent_blankline").setup({
		-- 	char = "▎",
		-- 	context_char = "▎",
		-- 	treesitter = true,
		-- 	show_current_context_start = true,
		-- 	show_current_context = true,
		-- })
	end,
}
