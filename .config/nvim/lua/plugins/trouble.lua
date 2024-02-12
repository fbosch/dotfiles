local map = vim.api.nvim_set_keymap
local silent = { noremap = true, silent = true }

return {
	"folke/trouble.nvim",
	dependencies = { "kyazdani42/nvim-web-devicons" },
	cmd = { "TroubleToggle", "Trouble", "TodoTrouble" },
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

		-- trouble toggling
		map("n", "<leader>tx", ":TroubleToggle<CR>", silent)
		map("n", "<leader>tw", ":Trouble workspace_diagnostics<CR>", silent)
		map("n", "<leader>td", ":Trouble document_diagnostics<CR>", silent)
		map("n", "<leader>tt", ":TodoTrouble<CR>", silent)
		map("n", "<leader>tl", ":Trouble loclist<CR>", silent)
		map("n", "<leader>tq", ":Trouble quickfix<CR>", silent)
		map("n", "<leader>tr", ":Trouble lsp_references<CR>", silent)
		map("n", "<leader>tz", ":TroubleClose<CR>", silent)
	end,
}