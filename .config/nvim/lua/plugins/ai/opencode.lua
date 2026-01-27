return {
	{
		"NickvanDyke/opencode.nvim",
		lazy = false,
		dependencies = {
			"folke/snacks.nvim",
		},
		init = function()
			-- Set global options before plugin loads
			vim.g.opencode_opts = {
				auto_reload = true,
				command = "opencode",
				provider = {
					enabled = "snacks",
					snacks = {
						win = {
							position = "left",
							width = 100,
						},
						terminal = {
							enabled = true,
						},
						env = {
							SHELL = "/bin/fish",
						},
					},
				},
			}
			vim.o.autoread = true
		end,
		config = function()
			local function focus_opencode_window()
				vim.schedule(function()
					for _, win in ipairs(vim.api.nvim_list_wins()) do
						local bufnr = vim.api.nvim_win_get_buf(win)
						local filetype = vim.bo[bufnr].filetype
						if filetype == "opencode" or filetype == "opencode_terminal" then
							vim.api.nvim_set_current_win(win)
							return
						end
					end
				end)
			end

			local function send_opencode(method, prompt, opts)
				require("opencode")[method](prompt, opts)
				if opts and opts.submit then
					focus_opencode_window()
				end
			end

			-- Set up opencode terminal-specific keymaps
			vim.api.nvim_create_autocmd("FileType", {
				pattern = "opencode_terminal",
				callback = function(args)
					local buf_opts = { buffer = args.buf, silent = true }

					-- Exit terminal with Ctrl-Esc (from terminal mode)
					vim.keymap.set("t", "<C-Esc>", function()
						vim.cmd("stopinsert")
						vim.cmd("wincmd p")
					end, vim.tbl_extend("force", buf_opts, { desc = "Exit opencode terminal" }))

					-- Exit with q (from normal mode only)
					vim.keymap.set("n", "q", function()
						vim.cmd("wincmd p")
					end, vim.tbl_extend("force", buf_opts, { desc = "Exit opencode terminal" }))

					-- Navigate splits in normal mode only (avoid terminal mode conflicts)
					vim.keymap.set("n", "<C-h>", "<C-w>h", buf_opts)
					vim.keymap.set("n", "<C-j>", "<C-w>j", buf_opts)
					vim.keymap.set("n", "<C-k>", "<C-w>k", buf_opts)
					vim.keymap.set("n", "<C-l>", "<C-w>l", buf_opts)
				end,
			})

			-- Core keymaps
			vim.keymap.set({ "n", "x" }, "<leader>ac", function()
				send_opencode("ask", "@this: ", { submit = true })
			end, { desc = "Ask opencode" })

			vim.keymap.set({ "n", "x" }, "<leader>as", function()
				require("opencode").select()
			end, { desc = "opencode actions" })

			vim.keymap.set({ "n", "x" }, "ga", function()
				send_opencode("prompt", "@this")
			end, { desc = "Add to opencode" })

			vim.keymap.set({ "n", "t" }, "<A-a>", function()
				require("opencode").toggle()
			end, { desc = "Toggle opencode" })

			-- Send selection to opencode with Alt-x (visual mode)
			vim.keymap.set("v", "<A-x>", function()
				local start_line = vim.fn.line("'<")
				local end_line = vim.fn.line("'>")
				local filename = vim.api.nvim_buf_get_name(0)

				if filename == "" then
					vim.notify("No file name for current buffer", vim.log.levels.WARN)
					return
				end

				local relative_path = vim.fn.fnamemodify(filename, ":.")
				local bufnr = vim.api.nvim_get_current_buf()
				local lines = vim.api.nvim_buf_get_lines(bufnr, start_line - 1, end_line, false)

				-- Format the code block with actual content
				local code_block = table.concat(lines, "\n")
				local formatted_text = string.format(
					"%s L%d-L%d \n ```%s\n%s\n```",
					relative_path,
					start_line,
					end_line,
					vim.bo.filetype,
					code_block
				)
				send_opencode("prompt", formatted_text)

				vim.notify(
					string.format(
						"Sent to opencode: %s (lines %d-%d) with %d lines",
						relative_path,
						start_line,
						end_line,
						#lines
					),
					vim.log.levels.INFO
				)
			end, { desc = "Send selection to opencode" })

			-- Send visible buffers to opencode with Alt-x (normal mode)
			vim.keymap.set("n", "<A-x>", function()
				local visible_files = {}
				local seen_buffers = {}

				for _, win in ipairs(vim.api.nvim_list_wins()) do
					local bufnr = vim.api.nvim_win_get_buf(win)

					if not seen_buffers[bufnr] then
						seen_buffers[bufnr] = true
						local filename = vim.api.nvim_buf_get_name(bufnr)

						if filename ~= "" and vim.fn.filereadable(filename) == 1 then
							local relative_path = vim.fn.fnamemodify(filename, ":.")
							table.insert(visible_files, "@" .. relative_path)
						end
					end
				end

				if #visible_files == 0 then
					vim.notify("No visible buffers to send", vim.log.levels.WARN)
					return
				end

				-- Send all visible files to opencode
				local formatted_text = table.concat(visible_files, " ")
				send_opencode("prompt", formatted_text)

				vim.notify(string.format("Sent %d visible buffers to opencode", #visible_files), vim.log.levels.INFO)
			end, { desc = "Send visible buffers to opencode" })

			-- Code actions with prompts (replacing ChatGPT commands)
			vim.keymap.set({ "n", "v" }, "<leader>ae", function()
				send_opencode("prompt", "explain")
			end, { desc = "Explain code" })

			vim.keymap.set({ "n", "v" }, "<leader>ao", function()
				send_opencode("prompt", "optimize")
			end, { desc = "Optimize code" })

			vim.keymap.set({ "n", "v" }, "<leader>ad", function()
				send_opencode("prompt", "document")
			end, { desc = "Add documentation" })

			vim.keymap.set({ "n", "v" }, "<leader>aa", function()
				send_opencode("prompt", "test")
			end, { desc = "Add tests" })

			vim.keymap.set({ "n", "v" }, "<leader>ar", function()
				send_opencode("prompt", "review")
			end, { desc = "Review code" })

			vim.keymap.set({ "n", "v" }, "<leader>af", function()
				send_opencode("prompt", "fix")
			end, { desc = "Fix diagnostics" })

			vim.keymap.set({ "n", "v" }, "<leader>ax", function()
				send_opencode("prompt", "diagnostics")
			end, { desc = "Explain diagnostics" })

			-- Custom prompts for grammar and translate (replacing ChatGPT functionality)
			vim.keymap.set({ "n", "v" }, "<leader>ag", function()
				send_opencode("ask", "Fix grammar and improve writing: @this", { submit = true })
			end, { desc = "Grammar correction" })

			vim.keymap.set({ "n", "v" }, "<leader>ak", function()
				send_opencode("ask", "Extract keywords from: @this", { submit = true })
			end, { desc = "Extract keywords" })

			vim.keymap.set({ "n", "v" }, "<leader>al", function()
				send_opencode("ask", "Analyze code readability: @this", { submit = true })
			end, { desc = "Code readability" })

			-- Listen for opencode events
			vim.api.nvim_create_autocmd("User", {
				pattern = "OpencodeEvent",
				callback = function(args)
					if args.data.event.type == "session.idle" then
						-- Session is idle, can trigger notifications or other actions
						vim.notify("opencode session idle", vim.log.levels.DEBUG)
					end
				end,
			})
		end,
	},
}
