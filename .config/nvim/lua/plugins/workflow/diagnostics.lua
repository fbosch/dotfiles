return {
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

		local group = vim.api.nvim_create_augroup("ReplaceQuickfixWithTrouble", {})
		vim.api.nvim_create_autocmd("BufWinEnter", {
			pattern = "quickfix",
			group = group,
			callback = replace_quickfix_with_trouble,
		})
	end,
}
