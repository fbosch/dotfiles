local register = require("config.pack.registry").register

register({
	{
		name = "checkmate.nvim",
		src = "https://github.com/bngarren/checkmate.nvim.git",
		dependencies = { "nvim-treesitter" },
		filetypes = { "markdown" },
		setup = function(context)
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

			local function enable_wrap_for_todo(buf)
				local filename = vim.fs.basename(vim.api.nvim_buf_get_name(buf)):lower()
				if filename ~= "todo.md" and filename ~= ".todo.md" then
					return
				end

				for _, win in ipairs(vim.fn.win_findbuf(buf)) do
					vim.api.nvim_set_option_value("wrap", true, { win = win })
				end
			end

			enable_wrap_for_todo(context.buf)
			vim.api.nvim_create_autocmd("FileType", {
				pattern = "markdown",
				callback = function(args)
					enable_wrap_for_todo(args.buf)
				end,
			})
		end,
	},
})

return {}
