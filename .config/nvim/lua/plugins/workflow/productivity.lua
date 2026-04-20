return {
	{
		"wakatime/vim-wakatime",
		lazy = false,
	},
	{
		"bngarren/checkmate.nvim",
		ft = "markdown",
		config = function()
			require("checkmate").setup({
				todo_states = {
					unchecked = {
						marker = "󰄱 ",
						order = 1,
					},
					checked = {
						marker = "󰄲 ",
						order = 2,
					},
				},
			})
			vim.api.nvim_create_autocmd("FileType", {
				pattern = "markdown",
				callback = function(args)
					local filename = vim.fn.expand("%:t"):lower()
					local targets = { "todo.md", ".todo.md" }

					local is_todo_file = false
					for _, target in ipairs(targets) do
						if filename == target then
							is_todo_file = true
						end
					end

					if is_todo_file then
						local map = require("utils").set_keymap
						vim.opt_local.wrap = true
					end
				end,
			})
		end,
	},
}
