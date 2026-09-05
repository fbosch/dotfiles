local function invoke_configured_mapping(lhs)
	local mode = vim.fn.mode(1):sub(1, 1)
	if mode == "v" or mode == "V" or mode == "\22" then
		mode = "x"
	elseif mode ~= "t" then
		mode = "n"
	end

	local mapping = vim.fn.maparg(lhs, mode, false, true)
	assert(type(mapping.callback) == "function", "missing configured opencode mapping: " .. lhs)
	mapping.callback()
end

local function key(lhs, mode, desc)
	return {
		lhs,
		function()
			invoke_configured_mapping(lhs)
		end,
		mode = mode,
		desc = desc,
	}
end

return {
	{
		name = "opencode.nvim",
		src = "https://github.com/NickvanDyke/opencode.nvim.git",
		enabled = function()
			return vim.env.CORPORATE == nil and vim.fn.executable("opencode") == 1
		end,
		keys = {
			key("<leader>ac", { "n", "x" }, "Ask opencode"),
			key("ga", { "n", "x" }, "Add to opencode"),
			key("<A-x>", { "n", "x" }, "Send to opencode"),
			key("<leader>as", { "n", "x" }, "opencode actions"),
			key("<leader>aS", "n", "Select opencode session"),
			key("<leader>ae", { "n", "v" }, "Explain code"),
			key("<leader>ao", { "n", "v" }, "Optimize code"),
			key("<leader>ad", { "n", "v" }, "Add documentation"),
			key("<leader>aa", { "n", "v" }, "Add tests"),
			key("<leader>ar", { "n", "v" }, "Review code"),
			key("<leader>af", { "n", "v" }, "Fix diagnostics"),
			key("<leader>ax", { "n", "v" }, "Explain diagnostics"),
			key("<leader>ag", { "n", "v" }, "Grammar correction"),
			key("<leader>ak", { "n", "v" }, "Extract keywords"),
			key("<leader>al", { "n", "v" }, "Code readability"),
		},
		dependencies = {
			"snacks.nvim",
		},
		init = function()
			local session = require("utils.session")
			vim.env.HERDR_MINI_SESSION_RESTORE = nil
			local infer_cache = {
				cwd = nil,
				session_id = nil,
				at = 0,
			}
			local infer_cache_ttl_ms = 15000
			local opencode_db_path = vim.fn.expand("~/.local/share/opencode/opencode.db")
			local opencode_terminal_opts = { win = { position = "left", width = 100 } }
			local opencode_terminal_instance
			local opened_fresh_opencode = false

			local function normalize_path(path)
				if type(path) ~= "string" or path == "" then
					return nil
				end

				local normalized = vim.fs.normalize(path)
				if normalized:sub(-1) == "/" and #normalized > 1 then
					normalized = normalized:gsub("/+$", "")
				end

				return normalized
			end

			local function sql_string(value)
				return "'" .. value:gsub("'", "''") .. "'"
			end

			local function saved_session_id()
				local nvim_session = session.get_current(vim.fn.getcwd())
				if nvim_session == nil then
					return nil
				end

				local session_id = session.get_metadata(nvim_session).opencode_session_id
				return type(session_id) == "string" and session_id or nil
			end

			local function is_herdr_session()
				local nvim_session = session.get_current(vim.fn.getcwd())
				return nvim_session ~= nil
					and nvim_session.specifier:match("^herdr%-w[A-Za-z0-9_-]+%-p[A-Za-z0-9_-]+$") ~= nil
			end

			local function capture_fresh_session_id(cwd)
				local normalized_cwd = normalize_path(cwd)
				if normalized_cwd == nil then
					return nil
				end

				local nvim_session = session.get_current(normalized_cwd)
				if nvim_session == nil then
					return nil
				end

				local now = vim.uv.now()
				if infer_cache.cwd == normalized_cwd and (now - infer_cache.at) <= infer_cache_ttl_ms then
					return infer_cache.session_id
				end

				local cwd_sql = sql_string(normalized_cwd)
				local query = "select id from session where time_archived is null and parent_id is null"
					.. " and (directory = "
					.. cwd_sql
					.. " or (length(directory) > length("
					.. cwd_sql
					.. ") and substr(directory, 1, length("
					.. cwd_sql
					.. ") + 1) = "
					.. cwd_sql
					.. " || '/') or (length("
					.. cwd_sql
					.. ") > length(directory) and substr("
					.. cwd_sql
					.. ", 1, length(directory) + 1) = directory || '/'))"
					.. " order by time_updated desc limit 1"

				local result = vim.system({ "sqlite3", opencode_db_path, "-json", query }, { text = true }):wait()
				if result.code ~= 0 or type(result.stdout) ~= "string" then
					result = vim.system({ "opencode", "db", query, "--format", "json" }, { text = true }):wait()
				end

				if result.code ~= 0 or type(result.stdout) ~= "string" or result.stdout == "" then
					infer_cache = { cwd = normalized_cwd, session_id = nil, at = now }
					return nil
				end

				local ok, rows = pcall(vim.json.decode, result.stdout)
				if ok == false or type(rows) ~= "table" then
					infer_cache = { cwd = normalized_cwd, session_id = nil, at = now }
					return nil
				end

				local first = rows[1]
				local session_id = type(first) == "table" and first.id or nil
				if type(session_id) ~= "string" or session_id == "" then
					session_id = nil
				end

				infer_cache = { cwd = normalized_cwd, session_id = session_id, at = now }
				if session_id ~= nil then
					session.set_opencode_session_id(session_id, nvim_session)
				end
				return session_id
			end

			local function opencode_command()
				local socket = vim.v.servername
				if type(socket) ~= "string" or socket == "" then
					error("opencode requires a Neovim RPC socket")
				end

				local environment = "OPENCODE_NVIM_SOCKET=" .. vim.fn.shellescape(socket) .. " "
				local pane_id = vim.env.HERDR_PANE_ID
				if vim.env.HERDR_ENV == "1" and type(pane_id) == "string" and pane_id ~= "" then
					environment = "env -u HERDR_PANE_ID OPENCODE_NVIM_HERDR_PANE_ID="
						.. vim.fn.shellescape(pane_id)
						.. " "
						.. environment
				end
				local session_id = saved_session_id()
				if type(session_id) ~= "string" or session_id == "" then
					opened_fresh_opencode = true
					return environment .. "opencode --port"
				end

				return environment .. "opencode --port --session " .. vim.fn.shellescape(session_id)
			end

			local function opencode_terminal()
				return require("snacks.terminal")
			end

			local function current_opencode_terminal()
				if opencode_terminal_instance ~= nil and opencode_terminal_instance:buf_valid() then
					return opencode_terminal_instance
				end

				opencode_terminal_instance = nil
				return nil
			end

			local function save_opencode_terminal_state()
				local nvim_session = session.get_current()
				if nvim_session == nil then
					return
				end

				local metadata = session.get_metadata(nvim_session)
				local terminal = current_opencode_terminal()
				local is_open = terminal ~= nil and terminal:valid()
				if metadata.opencode_terminal_open == is_open then
					return
				end

				metadata.opencode_terminal_open = is_open
				session.set_metadata(metadata, nvim_session)
			end

			local function open_opencode_terminal()
				local terminal = current_opencode_terminal()
				if terminal ~= nil then
					terminal:show():focus()
					return terminal
				end

				terminal = opencode_terminal().open(opencode_command(), opencode_terminal_opts)
				opencode_terminal_instance = terminal

				local function clear_terminal()
					if opencode_terminal_instance == terminal then
						opencode_terminal_instance = nil
					end
				end

				terminal:on("TermClose", clear_terminal, { buf = true })
				terminal:on("BufWipeout", clear_terminal, { buf = true })
				return terminal
			end

			local function connect_to_session(session_id, attempts)
				local function retry()
					if attempts > 1 then
						vim.defer_fn(function()
							connect_to_session(session_id, attempts - 1)
						end, 500)
					end
				end

				require("opencode.server.discovery")
					.locally()
					:next(function(servers)
						local function try_server(index)
							local server = servers[index]
							if server == nil then
								retry()
								return
							end

							server
								:get_sessions()
								:next(function(sessions)
									for _, candidate in ipairs(sessions) do
										if candidate.id == session_id then
											server:connect():catch(retry)
											return
										end
									end
									try_server(index + 1)
								end)
								:catch(function()
									try_server(index + 1)
								end)
						end

						try_server(1)
					end)
					:catch(retry)
			end

			vim.api.nvim_create_autocmd("User", {
				pattern = "SessionLoadPost",
				once = true,
				callback = function()
					if not is_herdr_session() then
						return
					end

					local metadata = session.get_metadata(session.get_current())
					if saved_session_id() == nil or metadata.opencode_terminal_open ~= true then
						return
					end

					vim.schedule(function()
						require("config.pack.loader").activate("opencode.nvim", { source = "SessionLoadPost" })
						open_opencode_terminal()
						connect_to_session(saved_session_id(), 10)
					end)
				end,
			})

			vim.api.nvim_create_autocmd("User", {
				pattern = "SessionSavePre",
				callback = function()
					save_opencode_terminal_state()
					if opened_fresh_opencode and saved_session_id() == nil then
						capture_fresh_session_id(vim.fn.getcwd())
					end
				end,
			})

			vim.g.opencode_opts = {
				server = {
					start = function()
						open_opencode_terminal()
					end,
					stop = function()
						local terminal = current_opencode_terminal()
						if terminal ~= nil then
							terminal:close()
						end
					end,
					toggle = function()
						local terminal = current_opencode_terminal()
						if terminal ~= nil then
							terminal:toggle()
							return
						end

						open_opencode_terminal()
					end,
				},
				events = {
					enabled = true,
				},
			}
		end,
		setup = function()
			local opencode_terminal_var = "is_opencode_terminal"

			local function is_opencode_terminal(buf)
				if vim.b[buf][opencode_terminal_var] == true then
					return true
				end

				if vim.bo[buf].buftype ~= "terminal" then
					return false
				end

				local name = vim.api.nvim_buf_get_name(buf)
				return name:find("term://", 1, true) ~= nil
					and (
						name:find("opencode --port", 1, true) ~= nil
						or name:find("headroom wrap opencode", 1, true) ~= nil
					)
			end

			local function mark_opencode_terminal(buf)
				vim.b[buf][opencode_terminal_var] = true
			end

			local function record_source_context()
				local buf = vim.api.nvim_get_current_buf()
				local filetype = vim.bo[buf].filetype
				if vim.bo[buf].buftype ~= "" or filetype == "opencode" or filetype == "opencode_terminal" then
					return
				end

				local cursor = vim.api.nvim_win_get_cursor(0)
				vim.g.opencode_last_source_context = {
					buffer = buf,
					cursor = { line = cursor[1], column = cursor[2] + 1 },
				}
			end

			local function set_opencode_terminal_keymaps(buf)
				local buf_opts = { buffer = buf, silent = true }

				local function exit_opencode_terminal()
					if vim.fn.mode(1):sub(1, 1) == "t" then
						vim.cmd("stopinsert")
					end
					vim.cmd("wincmd p")
				end

				vim.keymap.set(
					"t",
					"<C-g>",
					exit_opencode_terminal,
					vim.tbl_extend("force", buf_opts, {
						desc = "Return to editor",
					})
				)
				vim.keymap.set(
					{ "n", "t" },
					"<C-\\>",
					exit_opencode_terminal,
					vim.tbl_extend("force", buf_opts, {
						desc = "Toggle opencode focus",
					})
				)

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
				end, vim.tbl_extend("force", buf_opts, { desc = "Submit in opencode terminal" }))
			end

			local function configure_opencode_terminal(buf)
				mark_opencode_terminal(buf)
				vim.bo[buf].buflisted = false
				set_opencode_terminal_keymaps(buf)
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

					require("opencode.config").opts.server.start()
				end)
			end

			local function ask_opencode_and_focus_after_submit(default)
				require("opencode.server.discovery")
					.get()
					:next(function(server)
						local context = require("opencode.context").new(server)
						return require("opencode.ui.ask").ask(default, context):next(function(input)
							return require("opencode.api.prompt").prompt(input, context):next(function()
								if not input:match(" $") then
									focus_opencode_window()
								end
							end)
						end)
					end)
					:catch(function(err)
						if err then
							vim.notify(err, vim.log.levels.ERROR, { title = "opencode" })
						end
					end)
			end

			local function append_opencode(prompt)
				require("opencode").prompt(prompt .. " ")
				focus_opencode_window()
			end

			local function configured_prompt(name)
				return require("opencode.config").opts.select.prompts[name] or name
			end

			local function opencode_bridge_health()
				local socket = vim.v.servername
				if type(socket) ~= "string" or socket == "" then
					return "unavailable (Neovim socket missing)"
				end

				local bridge = vim.fn.expand("~/.config/opencode/mcp/neovim/neovim-context.ts")
				if vim.fn.filereadable(bridge) == 0 then
					return "unavailable (bridge not found)"
				end

				return "configured (bound to " .. socket .. ")"
			end

			local function show_opencode_health()
				local connected_server = require("opencode.server").connected
				local status = require("opencode.events.status").statusline()
				local bridge_status = opencode_bridge_health()
				local terminal_bufnr = nil

				for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
					if is_opencode_terminal(bufnr) then
						terminal_bufnr = bufnr
						break
					end
				end

				local function notify(server_status)
					local lines = {
						"opencode health",
						"--------------",
						"Server: " .. server_status,
						string.format("Status: %s", status),
						string.format("Bridge: %s", bridge_status),
						string.format(
							"Terminal: %s",
							terminal_bufnr and ("alive (buf " .. terminal_bufnr .. ")") or "not found"
						),
						string.format("Nvim CWD: %s", vim.fn.getcwd()),
					}

					vim.notify(table.concat(lines, "\n"), vim.log.levels.INFO, { title = "OpencodeHealth" })
				end

				if type(connected_server) == "table" then
					notify(string.format("connected (%s, cwd %s)", connected_server.url, connected_server.cwd))
					return
				end

				require("opencode.server.discovery")
					.locally()
					:next(function(servers)
						local cwd = vim.fn.getcwd()
						local matches = vim.tbl_filter(function(server)
							return server.cwd:find(cwd, 1, true) == 1 or cwd:find(server.cwd, 1, true) == 1
						end, servers)

						if #matches == 1 then
							local server = matches[1]
							notify(string.format("discoverable (%s, cwd %s)", server.url, server.cwd))
						elseif #matches > 1 then
							notify(string.format("ambiguous (%d matching servers)", #matches))
						else
							notify("disconnected")
						end
					end)
					:catch(function()
						notify("disconnected")
					end)
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
						configure_opencode_terminal(args.buf)
						pcall(vim.cmd, "startinsert")
					end
				end,
			})

			for _, buf in ipairs(vim.api.nvim_list_bufs()) do
				if is_opencode_terminal(buf) then
					configure_opencode_terminal(buf)
				end
			end

			vim.api.nvim_create_autocmd("WinEnter", {
				pattern = "*",
				callback = function(args)
					if is_opencode_terminal(args.buf) then
						pcall(vim.cmd, "startinsert")
					end
				end,
			})

			vim.api.nvim_create_autocmd({ "BufEnter", "CursorMoved", "WinLeave" }, {
				callback = record_source_context,
			})

			vim.api.nvim_create_user_command("OpencodeHealth", show_opencode_health, {
				desc = "Show opencode integration health",
			})

			-- Prompt workflows remain OpenCode-owned until the Pi prompt bridge passes its live gate.
			vim.keymap.set({ "n", "x" }, "<leader>ac", function()
				ask_opencode_and_focus_after_submit("@this: ")
			end, { desc = "Ask opencode" })

			vim.keymap.set({ "n", "x" }, "ga", function()
				append_opencode("@this")
			end, { desc = "Add to opencode" })

			vim.keymap.set("x", "<A-x>", function()
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
				local code_block = table.concat(lines, "\n")
				local formatted_text = string.format(
					"%s L%d-L%d \n ```%s\n%s\n```",
					relative_path,
					start_line,
					end_line,
					vim.bo.filetype,
					code_block
				)
				append_opencode(formatted_text)

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
			end, { desc = "Send to opencode" })

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

				append_opencode(table.concat(visible_files, " "))
				vim.notify(string.format("Sent %d visible buffers to opencode", #visible_files), vim.log.levels.INFO)
			end, { desc = "Send to opencode" })

			-- OpenCode-specific actions remain available during the Pi rollback period.
			vim.keymap.set({ "n", "x" }, "<leader>as", function()
				require("opencode").select()
			end, { desc = "opencode actions" })

			vim.keymap.set("n", "<leader>aS", function()
				require("opencode").command("session.select")
			end, { desc = "Select opencode session" })

			-- Code actions with prompts (replacing ChatGPT commands)
			vim.keymap.set({ "n", "v" }, "<leader>ae", function()
				append_opencode(configured_prompt("explain"))
			end, { desc = "Explain code" })

			vim.keymap.set({ "n", "v" }, "<leader>ao", function()
				append_opencode(configured_prompt("optimize"))
			end, { desc = "Optimize code" })

			vim.keymap.set({ "n", "v" }, "<leader>ad", function()
				append_opencode(configured_prompt("document"))
			end, { desc = "Add documentation" })

			vim.keymap.set({ "n", "v" }, "<leader>aa", function()
				append_opencode(configured_prompt("test"))
			end, { desc = "Add tests" })

			vim.keymap.set({ "n", "v" }, "<leader>ar", function()
				append_opencode(configured_prompt("review"))
			end, { desc = "Review code" })

			vim.keymap.set({ "n", "v" }, "<leader>af", function()
				append_opencode(configured_prompt("fix"))
			end, { desc = "Fix diagnostics" })

			vim.keymap.set({ "n", "v" }, "<leader>ax", function()
				append_opencode(configured_prompt("diagnostics"))
			end, { desc = "Explain diagnostics" })

			-- Custom prompts for grammar and translate (replacing ChatGPT functionality)
			vim.keymap.set({ "n", "v" }, "<leader>ag", function()
				ask_opencode_and_focus_after_submit("Fix grammar and improve writing: @this")
			end, { desc = "Grammar correction" })

			vim.keymap.set({ "n", "v" }, "<leader>ak", function()
				ask_opencode_and_focus_after_submit("Extract keywords from: @this")
			end, { desc = "Extract keywords" })

			vim.keymap.set({ "n", "v" }, "<leader>al", function()
				ask_opencode_and_focus_after_submit("Analyze code readability: @this")
			end, { desc = "Code readability" })
		end,
	},
}
