return {
	{
		"NickvanDyke/opencode.nvim",
		lazy = false,
		dependencies = {
			"folke/snacks.nvim",
		},
		init = function()
			local opencode_session = require("utils.opencode_session")
			local function opencode_command()
				return opencode_session.build_start_command("opencode --port")
			end

			vim.g.opencode_opts = {
				server = {
					start = function()
						require("opencode.terminal").start(opencode_command(), { split = "left", width = 100 })
					end,
					stop = function()
						require("opencode.terminal").stop()
					end,
					toggle = function()
						require("opencode.terminal").toggle(opencode_command(), { split = "left", width = 100 })
					end,
				},
			}
		end,
		config = function()
			local opencode_session = require("utils.opencode_session")

			local function is_opencode_terminal(buf)
				if vim.bo[buf].buftype ~= "terminal" then
					return false
				end

				local name = vim.api.nvim_buf_get_name(buf)
				return name:find("term://", 1, true) ~= nil and name:find("opencode --port", 1, true) ~= nil
			end

			local function set_opencode_terminal_keymaps(buf)
				local buf_opts = { buffer = buf, silent = true }

				vim.keymap.set("t", "<C-Esc>", function()
					vim.cmd("stopinsert")
					vim.cmd("wincmd p")
				end, vim.tbl_extend("force", buf_opts, { desc = "Exit opencode terminal" }))

				vim.keymap.set("n", "q", function()
					vim.cmd("wincmd p")
				end, vim.tbl_extend("force", buf_opts, { desc = "Exit opencode terminal" }))

				vim.keymap.set("n", "<C-h>", "<C-w>h", buf_opts)
				vim.keymap.set("n", "<C-j>", "<C-w>j", buf_opts)
				vim.keymap.set("n", "<C-k>", "<C-w>k", buf_opts)
				vim.keymap.set("n", "<C-l>", "<C-w>l", buf_opts)

				vim.keymap.set("t", "<CR>", function()
					local job_id = vim.b[buf].terminal_job_id
					if job_id then
						vim.api.nvim_chan_send(job_id, "\r")
					else
						vim.api.nvim_feedkeys(vim.keycode("<CR>"), "t", false)
					end
					opencode_session.request_sync()
				end, vim.tbl_extend("force", buf_opts, { desc = "Submit in opencode terminal" }))
			end

			local function focus_opencode_window()
				vim.schedule(function()
					for _, win in ipairs(vim.api.nvim_list_wins()) do
						local bufnr = vim.api.nvim_win_get_buf(win)
						local filetype = vim.bo[bufnr].filetype
						if filetype == "opencode" or is_opencode_terminal(bufnr) then
							vim.api.nvim_set_current_win(win)
							if is_opencode_terminal(bufnr) then
								pcall(vim.cmd, "startinsert")
							end
							return
						end
					end
				end)
			end

			local function send_opencode(method, prompt, opts)
				require("opencode")[method](prompt, opts)
				if opts and opts.submit then
					opencode_session.request_sync()
				end
				if not (opts and opts.submit) then
					focus_opencode_window()
				end
			end

			-- Keep opencode UI buffers out of bufferline
			vim.api.nvim_create_autocmd("FileType", {
				pattern = { "opencode", "opencode_terminal" },
				callback = function(args)
					vim.bo[args.buf].buflisted = false
				end,
			})

			vim.api.nvim_create_autocmd("TermOpen", {
				pattern = "*",
				callback = function(args)
					if is_opencode_terminal(args.buf) then
						vim.bo[args.buf].buflisted = false
						set_opencode_terminal_keymaps(args.buf)
						pcall(vim.cmd, "startinsert")
						opencode_session.request_sync({ delays = { 500, 1500, 3000 } })
					end
				end,
			})

			vim.api.nvim_create_autocmd("WinEnter", {
				pattern = "*",
				callback = function(args)
					if is_opencode_terminal(args.buf) then
						pcall(vim.cmd, "startinsert")
					end
				end,
			})

			vim.api.nvim_create_autocmd("User", {
				pattern = { "SessionSavePre", "SessionLoadPost" },
				callback = function(args)
					if args.match == "SessionSavePre" then
						opencode_session.persist_current_session_id()
					else
						opencode_session.restore_saved_session_id()
					end
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
		end,
	},
}
