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
				events = {
					enabled = true,
				},
			}
		end,
		config = function()
			local opencode_session = require("utils.opencode_session")
			local session = require("utils.session")
			local opencode_terminal_var = "is_opencode_terminal"

			local function extract_session_id(value)
				if type(value) ~= "table" then
					return nil
				end

				local direct_id = value.sessionID or value.sessionId or value.session_id
				if type(direct_id) == "string" and direct_id ~= "" then
					return direct_id
				end

				if type(value.info) == "table" and type(value.info.id) == "string" and value.info.id ~= "" then
					return value.info.id
				end

				if type(value.id) == "string" and value.id:find("^ses_") == 1 then
					return value.id
				end

				for _, child in pairs(value) do
					if type(child) == "table" then
						local nested = extract_session_id(child)
						if type(nested) == "string" and nested ~= "" then
							return nested
						end
					end
				end

				return nil
			end

			local function sync_session_from_event(args)
				local event = args.data and args.data.event
				if type(event) ~= "table" then
					return
				end

				local properties = event.properties
				if type(properties) ~= "table" then
					return
				end

				local session_id = extract_session_id(properties)
				if type(session_id) ~= "string" or session_id == "" then
					session_id = extract_session_id(event)
				end

				if type(session_id) ~= "string" or session_id == "" then
					if
						event.type == "session.status"
						or event.type == "session.idle"
						or event.type == "session.created"
						or event.type == "server.connected"
					then
						opencode_session.sync_now()
					end
					return
				end

				local event_cwd = nil
				local info = properties.info
				if type(info) == "table" then
					event_cwd = info.directory or info.worktree
				end

				if type(event_cwd) ~= "string" or event_cwd == "" then
					local connected_server = require("opencode.events").connected_server
					event_cwd = type(connected_server) == "table" and connected_server.cwd or nil
				end

				opencode_session.sync_from_event(session_id, { cwd = event_cwd })
			end

			local function is_opencode_terminal(buf)
				if vim.b[buf][opencode_terminal_var] == true then
					return true
				end

				if vim.bo[buf].buftype ~= "terminal" then
					return false
				end

				local name = vim.api.nvim_buf_get_name(buf)
				return name:find("term://", 1, true) ~= nil and name:find("opencode --port", 1, true) ~= nil
			end

			local function mark_opencode_terminal(buf)
				vim.b[buf][opencode_terminal_var] = true
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
					opencode_session.sync_now()
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
				if not (opts and opts.submit) then
					focus_opencode_window()
				end
			end

			local function show_opencode_health()
				local connected_server = require("opencode.events").connected_server
				local status = require("opencode.status").status
				local current_session_id = opencode_session.get_current_session_id()
				local saved_session_id = session.read_opencode_id()
				local restore_state = opencode_session.get_last_restore_state()
				local sidecar_path = session.get_opencode_sidecar_path()
				local sidecar_stat = vim.uv.fs_stat(sidecar_path)
				local terminal_bufnr = nil
				local restore_at = "never"

				if type(restore_state) == "table" and type(restore_state.at) == "number" then
					restore_at = os.date("%Y-%m-%d %H:%M:%S", restore_state.at)
				end

				for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
					if is_opencode_terminal(bufnr) then
						terminal_bufnr = bufnr
						break
					end
				end

				local lines = {
					"opencode health",
					"--------------",
					string.format(
						"Server: %s",
						type(connected_server) == "table"
								and string.format(
									"connected (port %s, cwd %s)",
									tostring(connected_server.port),
									tostring(connected_server.cwd)
								)
								or "disconnected"
					),
					string.format("Status: %s", status or "unknown"),
					string.format("Session ID: %s", current_session_id or "<none>"),
					string.format("Saved Session ID: %s", saved_session_id or "<none>"),
					string.format(
						"Restore: %s (%s)",
						type(restore_state) == "table" and restore_state.status or "unknown",
						type(restore_state) == "table" and restore_state.detail or "no details"
					),
					string.format("Restore at: %s", restore_at),
					string.format("Sidecar: %s", sidecar_path),
					string.format("Sidecar exists: %s", sidecar_stat and "yes" or "no"),
					string.format("Terminal: %s", terminal_bufnr and ("alive (buf " .. terminal_bufnr .. ")") or "not found"),
					string.format("Nvim CWD: %s", vim.fn.getcwd()),
				}

				vim.notify(table.concat(lines, "\n"), vim.log.levels.INFO, { title = "OpencodeHealth" })
			end

			-- Keep opencode UI buffers out of bufferline
			vim.api.nvim_create_autocmd("FileType", {
				pattern = { "opencode", "opencode_terminal" },
				callback = function(args)
					vim.bo[args.buf].buflisted = false
					if args.match == "opencode_terminal" then
						mark_opencode_terminal(args.buf)
					end
				end,
			})

			vim.api.nvim_create_autocmd("TermOpen", {
				pattern = "*",
				callback = function(args)
					if is_opencode_terminal(args.buf) then
						mark_opencode_terminal(args.buf)
						vim.bo[args.buf].buflisted = false
						set_opencode_terminal_keymaps(args.buf)
						local cwd = vim.fn.getcwd()
						opencode_session.restore_saved_session_id(cwd)
						opencode_session.connect_server_noninteractive()
						vim.defer_fn(function()
							opencode_session.select_session_on_connected_server(nil, { cwd = cwd })
							opencode_session.sync_debounced(200)
						end, 300)
						pcall(vim.cmd, "startinsert")
					end
				end,
			})

			vim.api.nvim_create_autocmd("User", {
				pattern = "OpencodeEvent:*",
				callback = sync_session_from_event,
			})

			vim.api.nvim_create_autocmd("User", {
				pattern = "OpencodeEvent:server.connected",
				callback = function()
					local connected_server = require("opencode.events").connected_server
					local server_cwd = type(connected_server) == "table" and connected_server.cwd or nil
					opencode_session.restore_saved_session_id(server_cwd)
					opencode_session.select_session_on_connected_server(nil, { cwd = server_cwd })
					opencode_session.sync_debounced(200)
				end,
			})

			vim.api.nvim_create_autocmd("DirChanged", {
				pattern = "*",
				callback = function()
					local event_data = vim.v.event
					local cwd = type(event_data) == "table" and event_data.cwd or vim.fn.getcwd()
					opencode_session.restore_saved_session_id(cwd)
					opencode_session.connect_server_noninteractive()
					opencode_session.select_session_on_connected_server(nil, { cwd = cwd })
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

			vim.api.nvim_create_autocmd("TextChangedT", {
				pattern = "*",
				callback = function(args)
					if is_opencode_terminal(args.buf) == false then
						return
					end

					opencode_session.sync_debounced(150)
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

			vim.api.nvim_create_user_command("OpencodeHealth", show_opencode_health, {
				desc = "Show opencode integration health",
			})

			-- Core keymaps
			vim.keymap.set({ "n", "x" }, "<leader>ac", function()
				send_opencode("ask", "@this: ", { submit = true })
			end, { desc = "Ask opencode" })

			vim.keymap.set({ "n", "x" }, "<leader>as", function()
				require("opencode").select()
			end, { desc = "opencode actions" })

			vim.keymap.set("n", "<leader>aS", function()
				opencode_session.select_and_persist()
			end, { desc = "Select opencode session" })

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
