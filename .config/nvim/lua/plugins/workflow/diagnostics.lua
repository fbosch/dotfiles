return {
	{
		"folke/trouble.nvim",
		dependencies = { "nvim-tree/nvim-web-devicons" },
		cmd = { "TroubleToggle", "Trouble", "TodoTrouble", "TroubleClose" },
		config = function()
			require("trouble").setup()

			-- Replace the quickfix window with Trouble when viewing TSC results
			local function replace_quickfix_with_trouble()
				local title = vim.fn.getqflist({ title = 0 }).title
				if title ~= "TSC" then
					return
				end

				local ok, trouble = pcall(require, "trouble")
				if ok then
					vim.defer_fn(function()
						vim.cmd("cclose")
						trouble.open("quickfix")
					end, 0)
				end
			end

			vim.api.nvim_create_autocmd("BufWinEnter", {
				pattern = "quickfix",
				callback = replace_quickfix_with_trouble,
				once = true,
			})
		end,
	},
	{
		"andythigpen/nvim-coverage",
		version = "*",
		config = function()
			require("coverage").setup({
				auto_reload = true,
			})
		end,
	},
}
