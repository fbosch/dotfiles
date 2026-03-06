return {
	{
		"NickvanDyke/opencode.nvim",
		lazy = false,
		dependencies = {
			"folke/snacks.nvim",
		},
		init = function()
			-- Set global options before plugin loads
			local cmd = "opencode --continue --port"
			if vim.fn.executable("mullvad-exclude") == 1 then
				cmd = "mullvad-exclude " .. cmd
			end

			vim.g.opencode_opts = {
				server = {
					start = function()
						require("opencode.terminal").start(cmd, { split = "left", width = 100 })
					end,
					stop = function()
						require("opencode.terminal").stop()
					end,
					toggle = function()
						require("opencode.terminal").toggle(cmd, { split = "left", width = 100 })
					end,
				},
			}
			vim.o.autoread = true
		end,
		config = function()
			-- Track opencode terminal job and process per buffer
			if not vim.g.opencode_buf_jobs then
				vim.g.opencode_buf_jobs = {}
			end
			local opencode_buf_jobs = vim.g.opencode_buf_jobs
			local debug_shutdown = vim.g.opencode_debug_shutdown == true

			local uv = vim.uv or vim.loop

			local function debug_notify(msg)
				if not debug_shutdown then
					return
				end

				vim.schedule(function()
					vim.notify("[opencode shutdown] " .. msg, vim.log.levels.DEBUG)
				end)
			end

			local function pid_is_alive(pid)
				if not pid or pid <= 0 then
					return false
				end

				if not uv or not uv.kill then
					return true
				end

				return pcall(uv.kill, pid, 0)
			end

			local function signal_pid_and_group(pid, signal)
				if not pid or pid <= 0 then
					return
				end

				pcall(vim.fn.system, { "kill", "-" .. signal, "-" .. tostring(pid) })
				pcall(vim.fn.system, { "kill", "-" .. signal, tostring(pid) })
			end

			local function stop_and_cleanup_opencode_for_buf(buf, skip_plugin_stop)
				if not skip_plugin_stop then
					pcall(function()
						require("opencode").stop()
					end)
					debug_notify(string.format("stop requested for buf=%d", buf))
				end

				local job = opencode_buf_jobs[buf]
				if not job then
					debug_notify(string.format("no tracked job for buf=%d", buf))
					return
				end

				if job.job_id and job.job_id > 0 then
					pcall(vim.fn.jobstop, job.job_id)
					debug_notify(string.format("jobstop sent for buf=%d job=%d", buf, job.job_id))
				end

				if job.pid and job.pid > 0 then
					signal_pid_and_group(job.pid, "TERM")
					debug_notify(string.format("TERM sent for buf=%d pid=%d", buf, job.pid))
					vim.defer_fn(function()
						if pid_is_alive(job.pid) then
							signal_pid_and_group(job.pid, "KILL")
							debug_notify(string.format("KILL sent for buf=%d pid=%d", buf, job.pid))
						end
					end, 1500)
				end

				opencode_buf_jobs[buf] = nil
				debug_notify(string.format("cleanup complete for buf=%d", buf))
			end

			local function focus_opencode_window()
				vim.schedule(function()
					for _, win in ipairs(vim.api.nvim_list_wins()) do
						local bufnr = vim.api.nvim_win_get_buf(win)
						local filetype = vim.bo[bufnr].filetype
						if filetype == "opencode" or filetype == "opencode_terminal" then
							vim.api.nvim_set_current_win(win)
							if filetype == "opencode_terminal" then
								pcall(vim.cmd, "startinsert")
							end
							return
						end
					end
				end)
			end

			local function send_opencode(method, prompt, opts)
				require("opencode")[method](prompt, opts)
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
					local name = vim.api.nvim_buf_get_name(args.buf)
					if name:find("term://", 1, true) and name:find("opencode", 1, true) then
						vim.bo[args.buf].buflisted = false
						pcall(vim.cmd, "startinsert")
					end
				end,
			})

			vim.api.nvim_create_autocmd("WinEnter", {
				pattern = "*",
				callback = function(args)
					if vim.bo[args.buf].filetype == "opencode_terminal" then
						pcall(vim.cmd, "startinsert")
					end
				end,
			})

			-- Set up opencode terminal-specific keymaps and cleanup
			vim.api.nvim_create_autocmd("FileType", {
				pattern = "opencode_terminal",
				callback = function(args)
					local buf_opts = { buffer = args.buf, silent = true }
					pcall(vim.cmd, "startinsert")

					-- Extract and store terminal job and process IDs
					vim.schedule(function()
						local ok, job_id = pcall(vim.api.nvim_buf_get_var, args.buf, "terminal_job_id")
						if ok and job_id and job_id > 0 then
							local pid = vim.fn.jobpid(job_id)
							opencode_buf_jobs[args.buf] = {
								job_id = job_id,
								pid = (pid and pid > 0) and pid or nil,
							}
							debug_notify(string.format("tracked buf=%d job=%d pid=%s", args.buf, job_id, tostring(pid)))
						end
					end)

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

			vim.api.nvim_create_autocmd("TermClose", {
				pattern = "*",
				callback = function(args)
					if opencode_buf_jobs[args.buf] then
						debug_notify(string.format("term closed for buf=%d", args.buf))
					end
					opencode_buf_jobs[args.buf] = nil
				end,
			})

			-- Clean up opencode instance when buffer is deleted/unloaded
			vim.api.nvim_create_autocmd({ "BufDelete", "BufUnload" }, {
				pattern = "*",
				callback = function(args)
					local filetype = vim.bo[args.buf].filetype
					if filetype == "opencode_terminal" or filetype == "opencode" or opencode_buf_jobs[args.buf] then
						stop_and_cleanup_opencode_for_buf(args.buf)
					end
				end,
			})

			-- Ensure cleanup happens before Neovim exits
			vim.api.nvim_create_autocmd("VimLeavePre", {
				callback = function()
					-- Stop the plugin gracefully
					pcall(function()
						require("opencode").stop()
					end)
					debug_notify("VimLeavePre: draining tracked jobs")

					-- Ensure all tracked opencode jobs for this instance are stopped
					for buf, _ in pairs(opencode_buf_jobs) do
						stop_and_cleanup_opencode_for_buf(buf, true)
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

			-- Listen for opencode events
			vim.api.nvim_create_autocmd("User", {
				pattern = "OpencodeEvent",
				callback = function(args)
					local event = args.data and args.data.event or {}
					if event.type == "closeCalled" or event.type == "close.called" then
						-- Find and cleanup the opencode terminal buffer for this instance
						for _, buf in ipairs(vim.api.nvim_list_bufs()) do
							if vim.bo[buf].filetype == "opencode_terminal" then
								stop_and_cleanup_opencode_for_buf(buf)
								break
							end
						end
					elseif event.type == "session.idle" then
						-- Session is idle, can trigger notifications or other actions
						vim.notify("opencode session idle", vim.log.levels.DEBUG)
					end
				end,
			})
		end,
	},
}
