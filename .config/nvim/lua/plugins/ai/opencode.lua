return {
	{
		"NickvanDyke/opencode.nvim",
		-- NOTE: plugin/ directory contains autoload files that prevent full lazy loading
		-- Using keys-only trigger for best balance
		keys = {
			{ "<leader>ac", mode = { "n", "x" }, desc = "Ask opencode" },
			{ "<leader>as", mode = { "n", "x" }, desc = "opencode actions" },
			{ "ga", mode = { "n", "x" }, desc = "Add to opencode" },
			{ "<A-a>", mode = { "n", "t" }, desc = "Toggle opencode" },
			{ "<A-x>", mode = { "n", "v" }, desc = "Send to opencode" },
			{ "<leader>ae", mode = { "n", "v" }, desc = "Explain code" },
			{ "<leader>ao", mode = { "n", "v" }, desc = "Optimize code" },
			{ "<leader>ad", mode = { "n", "v" }, desc = "Add documentation" },
			{ "<leader>aa", mode = { "n", "v" }, desc = "Add tests" },
			{ "<leader>ar", mode = { "n", "v" }, desc = "Review code" },
			{ "<leader>af", mode = { "n", "v" }, desc = "Fix diagnostics" },
			{ "<leader>ax", mode = { "n", "v" }, desc = "Explain diagnostics" },
			{ "<leader>ag", mode = { "n", "v" }, desc = "Grammar correction" },
			{ "<leader>ak", mode = { "n", "v" }, desc = "Extract keywords" },
			{ "<leader>al", mode = { "n", "v" }, desc = "Code readability" },
		},
		dependencies = {
			"folke/snacks.nvim",
		},
		init = function()
			-- Set global options before plugin loads
			vim.g.opencode_opts = {
				auto_reload = true,
				provider = {
					cmd = "opencode",
					enabled = "snacks",
					snacks = {
						win = {
							position = "left",
							width = 80,
						},
						terminal = {
							enabled = true,
						},
						-- env = {
						-- 	SHELL = "/bin/dash",
						-- },
					},
				},
			}
			vim.o.autoread = true
		end,
		config = function()
			-- Set up opencode terminal-specific keymaps
			vim.api.nvim_create_autocmd("FileType", {
				pattern = "opencode_terminal",
				callback = function(args)
					local opts = { buffer = args.buf, silent = true }

					-- Exit terminal with Ctrl-Esc or q (in normal mode)
					vim.keymap.set("t", "<C-Esc>", function()
						vim.cmd("stopinsert")
						vim.cmd("wincmd p")
					end, vim.tbl_extend("force", opts, { desc = "Exit opencode terminal" }))

					vim.keymap.set("n", "q", function()
						vim.cmd("wincmd p")
					end, vim.tbl_extend("force", opts, { desc = "Exit opencode terminal" }))

					-- Navigate splits with Shift + hjkl
					vim.keymap.set(
						"n",
						"<S-h>",
						"<C-w>h",
						vim.tbl_extend("force", opts, { desc = "Move to left split" })
					)
					vim.keymap.set(
						"n",
						"<S-j>",
						"<C-w>j",
						vim.tbl_extend("force", opts, { desc = "Move to below split" })
					)
					vim.keymap.set(
						"n",
						"<S-k>",
						"<C-w>k",
						vim.tbl_extend("force", opts, { desc = "Move to above split" })
					)
					vim.keymap.set(
						"n",
						"<S-l>",
						"<C-w>l",
						vim.tbl_extend("force", opts, { desc = "Move to right split" })
					)

					-- Session navigation (Shift+Ctrl to avoid conflict with Vim's scroll)
					vim.keymap.set("n", "<S-C-u>", function()
						require("opencode").command("session.half.page.up")
					end, vim.tbl_extend("force", opts, { desc = "opencode half page up" }))

					vim.keymap.set("n", "<S-C-d>", function()
						require("opencode").command("session.half.page.down")
					end, vim.tbl_extend("force", opts, { desc = "opencode half page down" }))
				end,
			})

			-- Core keymaps
			vim.keymap.set({ "n", "x" }, "<leader>ac", function()
				require("opencode").ask("@this: ", { submit = true })
			end, { desc = "Ask opencode" })

			vim.keymap.set({ "n", "x" }, "<leader>as", function()
				require("opencode").select()
			end, { desc = "opencode actions" })

			vim.keymap.set({ "n", "x" }, "ga", function()
				require("opencode").prompt("@this")
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
				require("opencode").prompt(formatted_text)

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
				require("opencode").prompt(formatted_text)

				vim.notify(string.format("Sent %d visible buffers to opencode", #visible_files), vim.log.levels.INFO)
			end, { desc = "Send visible buffers to opencode" })

			-- Code actions with prompts (replacing ChatGPT commands)
			vim.keymap.set({ "n", "v" }, "<leader>ae", function()
				require("opencode").prompt("explain")
			end, { desc = "Explain code" })

			vim.keymap.set({ "n", "v" }, "<leader>ao", function()
				require("opencode").prompt("optimize")
			end, { desc = "Optimize code" })

			vim.keymap.set({ "n", "v" }, "<leader>ad", function()
				require("opencode").prompt("document")
			end, { desc = "Add documentation" })

			vim.keymap.set({ "n", "v" }, "<leader>aa", function()
				require("opencode").prompt("test")
			end, { desc = "Add tests" })

			vim.keymap.set({ "n", "v" }, "<leader>ar", function()
				require("opencode").prompt("review")
			end, { desc = "Review code" })

			vim.keymap.set({ "n", "v" }, "<leader>af", function()
				require("opencode").prompt("fix")
			end, { desc = "Fix diagnostics" })

			vim.keymap.set({ "n", "v" }, "<leader>ax", function()
				require("opencode").prompt("diagnostics")
			end, { desc = "Explain diagnostics" })

			-- Custom prompts for grammar and translate (replacing ChatGPT functionality)
			vim.keymap.set({ "n", "v" }, "<leader>ag", function()
				require("opencode").ask("Fix grammar and improve writing: @this", { submit = true })
			end, { desc = "Grammar correction" })

			vim.keymap.set({ "n", "v" }, "<leader>ak", function()
				require("opencode").ask("Extract keywords from: @this", { submit = true })
			end, { desc = "Extract keywords" })

			vim.keymap.set({ "n", "v" }, "<leader>al", function()
				require("opencode").ask("Analyze code readability: @this", { submit = true })
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
