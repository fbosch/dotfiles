return {
	{
		"NickvanDyke/opencode.nvim",
		lazy = false,
		dependencies = {
			"folke/snacks.nvim",
		},
		init = function()
			-- Set global options before plugin loads
			local function shell_join(argv)
				local escaped = {}
				for _, arg in ipairs(argv) do
					escaped[#escaped + 1] = vim.fn.shellescape(arg)
				end
				return table.concat(escaped, " ")
			end

			local function opencode_base_cmd()
				if vim.fn.executable("mullvad-exclude") == 1 then
					return { "mullvad-exclude", "opencode" }
				end

				return { "opencode" }
			end

			local function resolve_worktree_dir()
				local buffer_name = vim.api.nvim_buf_get_name(0)
				local start_path = buffer_name ~= "" and vim.fs.dirname(buffer_name) or vim.fn.getcwd()
				local git_marker = vim.fs.find(".git", { path = start_path, upward = true })[1]

				if git_marker then
					return vim.fs.dirname(git_marker)
				end

				return vim.fn.getcwd()
			end

			local function find_worktree_session_id(worktree_dir)
				local list_cmd = opencode_base_cmd()
				list_cmd[#list_cmd + 1] = "session"
				list_cmd[#list_cmd + 1] = "list"
				list_cmd[#list_cmd + 1] = "--format"
				list_cmd[#list_cmd + 1] = "json"

				local result = vim.system(list_cmd, { cwd = worktree_dir, text = true }):wait()
				if result.code ~= 0 or result.stdout == "" then
					return nil
				end

				local ok, sessions = pcall(vim.json.decode, result.stdout)
				if ok == false or type(sessions) ~= "table" then
					return nil
				end

				local best_id = nil
				local best_updated = ""

				for _, session in ipairs(sessions) do
					if session.directory == worktree_dir then
						local updated = type(session.updated) == "string" and session.updated or ""
						if best_id == nil or updated > best_updated then
							best_id = session.id
							best_updated = updated
						end
					end
				end

				return best_id
			end

			local function build_opencode_cmd()
				local worktree_dir = resolve_worktree_dir()
				local session_id = find_worktree_session_id(worktree_dir)
				local cmd = opencode_base_cmd()

				cmd[#cmd + 1] = "--port"
				if session_id then
					cmd[#cmd + 1] = "--session"
					cmd[#cmd + 1] = session_id
				end

				return "cd " .. vim.fn.shellescape(worktree_dir) .. " && " .. shell_join(cmd)
			end

			vim.g.opencode_opts = {
				server = {
					start = function()
						require("opencode.terminal").start(build_opencode_cmd(), { split = "left", width = 100 })
					end,
					stop = function()
						require("opencode.terminal").stop()
					end,
					toggle = function()
						require("opencode.terminal").toggle(build_opencode_cmd(), { split = "left", width = 100 })
					end,
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

			-- Set up opencode terminal-specific keymaps
			vim.api.nvim_create_autocmd("FileType", {
				pattern = "opencode_terminal",
				callback = function(args)
					local buf_opts = { buffer = args.buf, silent = true }
					pcall(vim.cmd, "startinsert")

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

		end,
	},
}
