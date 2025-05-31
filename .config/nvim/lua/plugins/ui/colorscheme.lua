return {
	"mcchrish/zenbones.nvim",
	dependencies = { "rktjmp/lush.nvim" },
	lazy = false,
	priority = 1000,
	cond = vim.g.colors_name ~= "zenwritten",
	config = function()
		vim.g.zenbones_solid_line_nr = true

		-- undercurl
		vim.cmd([[let &t_Cs = "\e[4:3m"]])
		vim.cmd([[let &t_Ce = "\e[4:0m"]])

		-- Set colorscheme
		vim.cmd.colorscheme("zenwritten")

		-- Load custom highlights, fail gracefully if missing
		local ok, _ = pcall(require, "config.hls")
		if not ok then
			vim.notify("Custom highlights (config.hls) not found", vim.log.levels.WARN)
		end
	end,
}
