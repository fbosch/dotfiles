local M = {}

local config = {
	shell = "zsh",
	primary_cli = "codex",
	fallback_cli = "cursor-agent",
	prompt_mode = "argument", -- "argument" or "stdin"
	prompt_cli = nil,
	prompt_builder = nil,
	interactive_builder = nil,
	progress_key = "agent",
	progress_client_name = "agent",
	size_ratio = 0.33,
}

local agent_instance = nil
local commands_registered = false
local keymaps_registered = false
local last_notification_time = 0
local notification_cooldown = 5000
local terminal_open_time = 0
local launch_grace_period = 10000
local agent_progress = nil
local agent_mode = "ready"
local last_hexagon_time = 0
local hexagon_timeout = 2000
local pending_initial_text = nil

local function build_interactive_command()
	if config.interactive_builder then
		return config.interactive_builder(config)
	end

	local primary = config.primary_cli
	local fallback = config.fallback_cli

	if (not primary or primary == "") and fallback and fallback ~= "" then
		return fallback
	end

	primary = primary or "codex"

	if fallback and fallback ~= "" and fallback ~= primary then
		return string.format("%s 2>/dev/null || %s", primary, fallback)
	end

	return primary
end

local function build_prompt_command(prompt)
	if not prompt or prompt == "" then
		return nil
	end

	if config.prompt_builder then
		return config.prompt_builder(prompt, config)
	end

	local cli = config.prompt_cli or config.primary_cli
	if not cli or cli == "" then
		return nil
	end

	return string.format("%s %s", cli, vim.fn.shellescape(prompt))
end

local function resolve_command(prompt)
	if prompt and prompt ~= "" then
		if config.prompt_mode == "argument" then
			local prompt_cmd = build_prompt_command(prompt)
			if prompt_cmd then
				return prompt_cmd, false
			end
		end
		return build_interactive_command(), true
	end

	return build_interactive_command(), false
end

function M.configure(opts)
	if not opts then
		return
	end

	config = vim.tbl_deep_extend("force", config, opts)
end

local function has_hexagon_symbol(line)
	if line:match("⬡") or line:match("⬢") then
		return true
	end
	if line:match("\226\172\161") or line:match("\226\172\162") then
		return true
	end
	return false
end

local function strip_ansi_codes(str)
	str = str:gsub("\027%[[%d;]*m", "")
	str = str:gsub("\027%[[%d;]*[ABCDEFGJKST]", "")
	return str
end

local function is_hexagon_active()
	local current_time = vim.loop.now()
	return current_time - last_hexagon_time < hexagon_timeout
end

local function ensure_insert_mode()
	if agent_mode == "normal" then
		agent_instance:send("i")
		agent_mode = "insert"
		return true
	end
	return false
end

local function focus_terminal()
	if agent_instance and agent_instance:is_open() then
		for _, win in ipairs(vim.api.nvim_list_wins()) do
			local buf = vim.api.nvim_win_get_buf(win)
			if buf == agent_instance.bufnr then
				vim.api.nvim_set_current_win(win)
				vim.cmd("startinsert")
				break
			end
		end
	end
end

local function is_already_in_terminal(text)
	if not agent_instance or not agent_instance:is_open() then
		return false
	end

	local bufnr = agent_instance.bufnr
	if not bufnr or not vim.api.nvim_buf_is_valid(bufnr) then
		return false
	end

	local total_lines = vim.api.nvim_buf_line_count(bufnr)
	local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)

	local input_start_line = nil
	for i = total_lines, 1, -1 do
		local line = lines[i]
		if line and (line:match("^%s*→") or line:match("^%s*>")) then
			input_start_line = i
			break
		end
	end

	if not input_start_line then
		return false
	end

	local input_lines = {}
	for i = input_start_line, total_lines do
		table.insert(input_lines, lines[i])
	end

	local input_content = table.concat(input_lines, "\n")
	return input_content:find(text, 1, true) ~= nil
end

local function send_selection_to_agent()
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
	local selected_text = table.concat(lines, "\n")

	local formatted_text = string.format("@%s(%d-%d)\n```\n%s\n```", relative_path, start_line, end_line, selected_text)

	if not agent_instance then
		if not M.setup(formatted_text) then
			return
		end
		agent_instance:open()
		vim.notify(
			string.format("Sent to Agent: @%s(%d-%d) with %d lines", relative_path, start_line, end_line, #lines),
			vim.log.levels.INFO
		)
		vim.defer_fn(focus_terminal, 50)
		return
	end

	if is_already_in_terminal(formatted_text) then
		vim.notify(
			string.format("Selection @%s(%d-%d) already sent", relative_path, start_line, end_line),
			vim.log.levels.INFO
		)
		return
	end

	if not agent_instance:is_open() then
		agent_instance:open()
	end

	local needs_mode_switch = ensure_insert_mode()
	local delay = needs_mode_switch and 100 or 0

	vim.defer_fn(function()
		agent_instance:send(formatted_text)
		vim.defer_fn(focus_terminal, 50)
	end, delay)

	vim.notify(
		string.format("Sent to Agent: @%s(%d-%d) with %d lines", relative_path, start_line, end_line, #lines),
		vim.log.levels.INFO
	)
end

local function send_visible_buffers_to_agent()
	local visible_files = {}
	local seen_buffers = {}
	local new_files = {}

	for _, win in ipairs(vim.api.nvim_list_wins()) do
		local bufnr = vim.api.nvim_win_get_buf(win)

		if not seen_buffers[bufnr] then
			seen_buffers[bufnr] = true
			local filename = vim.api.nvim_buf_get_name(bufnr)

			if filename ~= "" and vim.fn.filereadable(filename) == 1 then
				local relative_path = vim.fn.fnamemodify(filename, ":.")
				local file_ref = "@" .. relative_path

				if not agent_instance or not is_already_in_terminal(file_ref) then
					table.insert(new_files, file_ref)
				end
				table.insert(visible_files, file_ref)
			end
		end
	end

	if #new_files == 0 then
		vim.notify("All visible buffers already sent to Agent", vim.log.levels.INFO)
		return
	end

	local formatted_text = table.concat(new_files, " ")

	if not agent_instance then
		if not M.setup(formatted_text) then
			return
		end
		agent_instance:open()
		vim.notify(
			string.format("Sent %d buffers to Agent (%d total visible)", #new_files, #visible_files),
			vim.log.levels.INFO
		)
		vim.defer_fn(focus_terminal, 100)
		return
	end

	if not agent_instance:is_open() then
		agent_instance:open()
	end

	local needs_mode_switch = ensure_insert_mode()
	local delay = needs_mode_switch and 100 or 0

	vim.defer_fn(function()
		agent_instance:send(formatted_text)
	end, delay)

	vim.notify(
		string.format("Sent %d new buffers to Agent (%d total visible)", #new_files, #visible_files),
		vim.log.levels.INFO
	)

	vim.defer_fn(focus_terminal, 100)
end

function M.setup(prompt)
	local Terminal = require("toggleterm.terminal").Terminal

	local cmd, send_initial_via_input = resolve_command(prompt)
	if not cmd or cmd == "" then
		vim.notify("Agent CLI command is not configured", vim.log.levels.ERROR)
		return nil
	end

	if send_initial_via_input and prompt and prompt ~= "" then
		pending_initial_text = prompt
	else
		pending_initial_text = nil
	end

	agent_instance = Terminal:new({
		cmd = cmd,
		shell = config.shell or vim.o.shell,
		direction = "vertical",
		start_in_insert = true,
		auto_scroll = true,
		size = function(term)
			if term.direction == "vertical" then
				local ratio = config.size_ratio or 0.33
				if ratio <= 0 or ratio >= 1 then
					ratio = 0.33
				end
				return math.max(20, math.floor(vim.o.columns * ratio))
			end
		end,
		hidden = false,
		on_stdout = function(_, _, data)
			if not data then
				return
			end

			local current_time = vim.loop.now()

			if current_time - terminal_open_time < launch_grace_period then
				return
			end

			vim.schedule(function()
				local found_hexagon = false
				local hexagon_message = nil

				for _, line in ipairs(data) do
					local lower_line = line:lower()

					if lower_line:match("%-%-+ insert %-%-+") or lower_line:match("insert mode") then
						agent_mode = "insert"
					elseif lower_line:match("%-%-+ normal %-%-+") or lower_line:match("normal mode") then
						agent_mode = "normal"
					end

					if has_hexagon_symbol(line) then
						found_hexagon = true
						last_hexagon_time = current_time
						hexagon_message = line:gsub("⬡", ""):gsub("⬢", "")
						hexagon_message = hexagon_message:gsub("\226\172\161", ""):gsub("\226\172\162", "")
						hexagon_message = strip_ansi_codes(hexagon_message)
						hexagon_message = hexagon_message:gsub("^%s*(.-)%s*$", "%1")
					end

					if current_time - last_notification_time >= notification_cooldown then
						if
							lower_line:match("accept")
							or lower_line:match("approve")
							or lower_line:match("allow")
							or lower_line:match("%(y/n%)")
							or lower_line:match("%(yes/no%)")
						then
							last_notification_time = current_time
							require("fidget").notify("⚠️  Permission needed - check terminal", vim.log.levels.WARN)
						end
					end
				end

				if found_hexagon and hexagon_message and hexagon_message ~= "" then
					-- Pad the message to ensure consistent length during animation
					local padded_message = hexagon_message
					if #padded_message < 15 then
						padded_message = padded_message .. string.rep(" ", 15 - #padded_message)
					end

					if not agent_progress then
						agent_progress = require("fidget.progress").handle.create({
							message = padded_message,
							key = config.progress_key or "agent",
							lsp_client = { name = config.progress_client_name or "agent" },
						})
					else
						agent_progress:report({ message = padded_message })
					end
				end

				if agent_progress and not found_hexagon and not is_hexagon_active() then
					agent_progress:finish()
					agent_progress = nil
				end
			end)
		end,
		on_open = function(term)
			terminal_open_time = vim.loop.now()
			last_hexagon_time = 0
			if agent_progress then
				agent_progress:finish()
				agent_progress = nil
			end

			vim.cmd("wincmd H")
			local ratio = config.size_ratio or 0.33
			if ratio <= 0 or ratio >= 1 then
				ratio = 0.33
			end
			local width = math.max(20, math.floor(vim.o.columns * ratio))
			vim.cmd("vertical resize " .. width)

			vim.api.nvim_buf_set_keymap(term.bufnr, "n", "q", "<cmd>close<CR>", { noremap = true, silent = true })
			vim.api.nvim_buf_set_keymap(
				term.bufnr,
				"t",
				"<Esc>",
				"<C-\\><C-n><C-w>l",
				{ noremap = true, silent = true }
			)
			vim.api.nvim_buf_set_keymap(term.bufnr, "t", "<A-a>", "<cmd>close<CR>", { noremap = true, silent = true })
			vim.api.nvim_buf_set_keymap(term.bufnr, "n", "<S-h>", "<C-w>h", { noremap = true, silent = true })
			vim.api.nvim_buf_set_keymap(term.bufnr, "n", "<S-l>", "<C-w>l", { noremap = true, silent = true })
			vim.api.nvim_buf_set_keymap(term.bufnr, "n", "<S-j>", "<C-w>j", { noremap = true, silent = true })
			vim.api.nvim_buf_set_keymap(term.bufnr, "n", "<S-k>", "<C-w>k", { noremap = true, silent = true })

			if pending_initial_text and pending_initial_text ~= "" then
				local text = pending_initial_text
				pending_initial_text = nil
				vim.defer_fn(function()
					if not agent_instance or not agent_instance:is_open() then
						return
					end

					local needs_mode_switch = ensure_insert_mode()
					local delay = needs_mode_switch and 100 or 0

					vim.defer_fn(function()
						agent_instance:send(text)
						vim.defer_fn(focus_terminal, 50)
					end, delay)
				end, 120)
			end
		end,
		on_close = function()
			last_hexagon_time = 0
			pending_initial_text = nil
			if agent_progress then
				agent_progress:finish()
				agent_progress = nil
			end
		end,
	})

	return agent_instance
end

function M.toggle()
	if not agent_instance then
		M.setup()
	end
	if agent_instance then
		agent_instance:toggle()
	end
end

function M.register_commands()
	if commands_registered then
		return
	end

	vim.api.nvim_create_user_command("SendSelectionToAgent", send_selection_to_agent, { range = true })
	vim.api.nvim_create_user_command("SendVisibleBuffersToAgent", send_visible_buffers_to_agent, {})
	commands_registered = true
end

function M.setup_keymaps()
	if keymaps_registered then
		return
	end

	vim.keymap.set("v", "<A-x>", ":<C-u>SendSelectionToAgent<CR>", {
		desc = "Send context (selection) to Agent",
		silent = true,
	})

	vim.keymap.set("n", "<A-x>", send_visible_buffers_to_agent, {
		desc = "Send context (buffers) to Agent",
		silent = true,
	})
	keymaps_registered = true
end

return M
