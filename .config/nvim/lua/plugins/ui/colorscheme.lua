return {
	"mcchrish/zenbones.nvim",
	dependencies = { "rktjmp/lush.nvim" },
	event = "VeryLazy",
	config = function()
		vim.g.zenbones_solid_line_nr = true
		-- undercurl
		vim.cmd([[let &t_Cs = "\e[4:3m"]])
		vim.cmd([[let &t_Ce = "\e[4:0m"]])

		vim.cmd([[colorscheme zenwritten]])

		require("config.hls")
	end,
}
