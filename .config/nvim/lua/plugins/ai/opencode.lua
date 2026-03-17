return {
	{
		"NickvanDyke/opencode.nvim",
		lazy = false,
		dependencies = {
			"folke/snacks.nvim",
		},
		init = function()
			-- Set global options before plugin loads
			local session = require("utils.session")
			local opencode_cmd_cache = {}
			local opencode_cmd_preload_inflight = {}
			local opencode_cmd_cache_ttl_ms = 30 * 60 * 1000

			local function get_cache_key(worktree_dir)
				return string.format("%s::%s", session.get_name(), worktree_dir)
			end

			local function get_cached_opencode_cmd(cache_key)
				local entry = opencode_cmd_cache[cache_key]
				if entry == nil then
					return nil
				end

				if vim.uv.now() > entry.expires_at then
					opencode_cmd_cache[cache_key] = nil
					return nil
				end

				return entry.cmd
			end

			local function set_cached_opencode_cmd(cache_key, opencode_cmd)
				opencode_cmd_cache[cache_key] = {
					cmd = opencode_cmd,
					expires_at = vim.uv.now() + opencode_cmd_cache_ttl_ms,
				}
			end

			local function shell_join(argv)
				local escaped = {}
				for _, arg in ipairs(argv) do
					escaped[#escaped + 1] = vim.fn.shellescape(arg)
				end
				return table.concat(escaped, " ")
			end

			local function merge_path(entries)
				local merged = {}
				local seen = {}

				for _, entry in ipairs(entries) do
					if entry ~= nil and entry ~= "" and seen[entry] ~= true then
						seen[entry] = true
						merged[#merged + 1] = entry
					end
				end

				return table.concat(merged, ":")
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

			local function select_latest_session_id_for_worktree(sessions, worktree_dir)
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

				return select_latest_session_id_for_worktree(sessions, worktree_dir)
			end

			local function build_opencode_cmd(worktree_dir, session_id)
				local cmd = opencode_base_cmd()
				local path = merge_path({
					vim.fn.expand("~/.local/bin"),
					vim.env.PNPM_HOME,
					vim.fn.expand("~/Library/pnpm"),
					vim.fn.expand("~/.local/share/pnpm"),
					"/opt/homebrew/bin",
					"/opt/homebrew/sbin",
					"/usr/local/bin",
					vim.env.PATH,
				})

				cmd[#cmd + 1] = "--port"
				if session_id then
					cmd[#cmd + 1] = "--session"
					cmd[#cmd + 1] = session_id
				end

				return "cd "
					.. vim.fn.shellescape(worktree_dir)
					.. " && env SHELL="
					.. vim.fn.shellescape(vim.o.shell)
					.. " PATH="
					.. vim.fn.shellescape(path)
					.. " "
					.. shell_join(cmd)
			end

			local function remember_session_id(session_id)
				if session_id then
					session.write_opencode_id(session_id)
				end
			end

			local function resolve_session_id(worktree_dir)
				local session_id = session.read_opencode_id()
				if session_id ~= nil then
					return session_id
				end

				session_id = find_worktree_session_id(worktree_dir)
				remember_session_id(session_id)
				return session_id
			end

			local function sync_session_id(worktree_dir)
				local session_id = find_worktree_session_id(worktree_dir)
				if session_id == nil then
					return
				end

				remember_session_id(session_id)
				set_cached_opencode_cmd(get_cache_key(worktree_dir), build_opencode_cmd(worktree_dir, session_id))
			end

			local function schedule_session_id_sync(worktree_dir)
				if session.read_opencode_id() ~= nil then
					return
				end

				vim.defer_fn(function()
					sync_session_id(worktree_dir)
				end, 1000)
			end

			local function ensure_opencode_cmd()
				local worktree_dir = resolve_worktree_dir()
				local cache_key = get_cache_key(worktree_dir)
				local cached_opencode_cmd = get_cached_opencode_cmd(cache_key)
				if cached_opencode_cmd ~= nil then
					return cached_opencode_cmd
				end

				local session_id = resolve_session_id(worktree_dir)
				local opencode_cmd = build_opencode_cmd(worktree_dir, session_id)
				set_cached_opencode_cmd(cache_key, opencode_cmd)
				schedule_session_id_sync(worktree_dir)
				return opencode_cmd
			end

			local function preload_opencode_cmd()
				local worktree_dir = resolve_worktree_dir()
				local cache_key = get_cache_key(worktree_dir)
				if get_cached_opencode_cmd(cache_key) ~= nil or opencode_cmd_preload_inflight[cache_key] == true then
					return
				end

				local session_id = session.read_opencode_id()
				if session_id ~= nil then
					set_cached_opencode_cmd(cache_key, build_opencode_cmd(worktree_dir, session_id))
					return
				end

				opencode_cmd_preload_inflight[cache_key] = true

				local list_cmd = opencode_base_cmd()
				list_cmd[#list_cmd + 1] = "session"
				list_cmd[#list_cmd + 1] = "list"
				list_cmd[#list_cmd + 1] = "--format"
				list_cmd[#list_cmd + 1] = "json"

				vim.system(list_cmd, { cwd = worktree_dir, text = true }, function(result)
					local session_id = nil
					if result.code == 0 and result.stdout ~= "" then
						local ok, sessions = pcall(vim.json.decode, result.stdout)
						if ok and type(sessions) == "table" then
							session_id = select_latest_session_id_for_worktree(sessions, worktree_dir)
						end
					end

					vim.schedule(function()
						local opencode_cmd = build_opencode_cmd(worktree_dir, session_id)
						remember_session_id(session_id)
						set_cached_opencode_cmd(cache_key, opencode_cmd)
						opencode_cmd_preload_inflight[cache_key] = nil
					end)
				end)
			end

			vim.g.opencode_opts = {
				server = {
					start = function()
						require("opencode.terminal").start(ensure_opencode_cmd(), { split = "left", width = 100 })
					end,
					stop = function()
						require("opencode.terminal").stop()
					end,
					toggle = function()
						require("opencode.terminal").toggle(ensure_opencode_cmd(), { split = "left", width = 100 })
					end,
				},
			}

			vim.api.nvim_create_autocmd("User", {
				pattern = "SessionWipePost",
				callback = function()
					opencode_cmd_cache = {}
					opencode_cmd_preload_inflight = {}
				end,
			})

			vim.api.nvim_create_autocmd("User", {
				pattern = "OpencodeEvent:session.*",
				callback = function(args)
					local data = args.data
					if not data or not data.event or not data.event.properties then
						return
					end

					local props = data.event.properties
					local new_id = props.sessionId or props.sessionID
					if type(new_id) ~= "string" or new_id == "" then
						return
					end

					local current_id = session.read_opencode_id()
					if new_id == current_id then
						return
					end

					remember_session_id(new_id)
					opencode_cmd_cache = {}
				end,
			})

			vim.schedule(preload_opencode_cmd)
			vim.o.autoread = true
		end,
		config = function()
			local function is_opencode_terminal(buf)
				if vim.bo[buf].buftype ~= "terminal" then
					return false
				end

				local name = vim.api.nvim_buf_get_name(buf)
				return name:find("term://", 1, true) ~= nil and name:find("opencode", 1, true) ~= nil
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
