return {
	name = "zenbones.nvim",
	src = "https://github.com/mcchrish/zenbones.nvim.git",
	root = false,
	setup = function()
		if vim.g.colors_name == "zenwritten" then
			return
		end

		-- Use Zenwritten's bundled static theme to avoid loading Lush at startup.
		vim.g.zenwritten_compat = 1
		vim.cmd([[let &t_Cs = "\e[4:3m"]])
		vim.cmd([[let &t_Ce = "\e[4:0m"]])
		vim.cmd.colorscheme("zenwritten")

		local ok = pcall(require, "config.hls")
		if not ok then
			vim.notify("Custom highlights (config.hls) not found", vim.log.levels.WARN)
		end
	end,
}
