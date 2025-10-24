local M = {}

local config = {
	shell = "zsh",
	primary_cli = "codex",
	fallback_cli = "cursor-agent",
	prompt_mode = "argument", -- "argument" or "stdin"
	prompt_cli = nil,
	prompt_builder = nil,
	interactive_builder = nil,
	size_ratio = 0.33,
}

local agent_instance = nil
local commands_registered = false
local keymaps_registered = false
local last_notification_time = 0
local notification_cooldown = 5000
local terminal_open_time = 0
local launch_grace_period = 10000
local agent_mode = "ready"
local pending_initial_text = nil

local function get_terminal_width()
	local ratio = config.size_ratio or 0.33
	if ratio <= 0 or ratio >= 1 then
		ratio = 0.33
	end
	return math.max(20, math.floor(vim.o.columns * ratio))
end

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

local function ensure_insert_mode()
	if agent_mode == "normal" and agent_instance then
		agent_instance:send("i")
		agent_mode = "insert"
		return true
	end
	return false
end

local function focus_terminal()
	if not agent_instance or not agent_instance:is_open() then
		return
	end

	local wins = vim.fn.win_findbuf(agent_instance.bufnr)
	if not wins or #wins == 0 then
		return
	end

	if pcall(vim.api.nvim_set_current_win, wins[1]) then
		vim.cmd("startinsert")
	end
end

local function ensure_agent(initial_text, focus_delay)
	focus_delay = focus_delay or 50

	if agent_instance then
		return true, false
	end

	if not M.setup(initial_text) then
		return false, false
	end

	agent_instance:open()
	vim.defer_fn(focus_terminal, focus_delay)
	return true, true
end

local function send_text_to_agent(text, opts)
	opts = opts or {}

	if not agent_instance then
		return false
	end

	if not agent_instance:is_open() then
		agent_instance:open()
	end

	local needs_mode_switch = ensure_insert_mode()
	local delay = needs_mode_switch and (opts.mode_switch_delay or 100) or 0

	vim.defer_fn(function()
		agent_instance:send(text)
		if opts.focus_delay then
			vim.defer_fn(focus_terminal, opts.focus_delay)
		end
	end, delay)

	return true
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
	local input_start_line
	for i = total_lines, 1, -1 do
		local line = vim.api.nvim_buf_get_lines(bufnr, i - 1, i, false)[1]
		if line and (line:match("^%s*→") or line:match("^%s*>")) then
			input_start_line = i
			break
		end
	end

	if not input_start_line then
		return false
	end

	local input_lines = vim.api.nvim_buf_get_lines(bufnr, input_start_line - 1, total_lines, false)
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

	local ok, created = ensure_agent(formatted_text, 50)
	if not ok then
		return
	end

	if created then
		vim.notify(
			string.format("Sent to Agent: @%s(%d-%d) with %d lines", relative_path, start_line, end_line, #lines),
			vim.log.levels.INFO
		)
		return
	end

	if is_already_in_terminal(formatted_text) then
		vim.notify(
			string.format("Selection @%s(%d-%d) already sent", relative_path, start_line, end_line),
			vim.log.levels.INFO
		)
		return
	end

	send_text_to_agent(formatted_text, { focus_delay = 50 })

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

	local ok, created = ensure_agent(formatted_text, 100)
	if not ok then
		return
	end

	if created then
		vim.notify(
			string.format("Sent %d buffers to Agent (%d total visible)", #new_files, #visible_files),
			vim.log.levels.INFO
		)
		return
	end

	send_text_to_agent(formatted_text, { focus_delay = 100 })

	vim.notify(
		string.format("Sent %d new buffers to Agent (%d total visible)", #new_files, #visible_files),
		vim.log.levels.INFO
	)
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
				return get_terminal_width()
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
				for _, line in ipairs(data) do
					local lower_line = (line or ""):lower()

					if lower_line:match("%-%-+ insert %-%-+") or lower_line:match("insert mode") then
						agent_mode = "insert"
					elseif lower_line:match("%-%-+ normal %-%-+") or lower_line:match("normal mode") then
						agent_mode = "normal"
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
							vim.notify("Permission needed - check terminal", vim.log.levels.WARN)
						end
					end
				end
			end)
		end,
		on_open = function(term)
			terminal_open_time = vim.loop.now()

			vim.cmd("wincmd H")
			local width = get_terminal_width()
			vim.cmd("vertical resize " .. width)

			local keymaps = {
				{ mode = "n", lhs = "q", rhs = "<cmd>close<CR>" },
				{ mode = "t", lhs = "<Esc>", rhs = "<C-\\><C-n><C-w>l" },
				{ mode = "t", lhs = "<A-a>", rhs = "<cmd>close<CR>" },
				{ mode = "n", lhs = "<S-h>", rhs = "<C-w>h" },
				{ mode = "n", lhs = "<S-l>", rhs = "<C-w>l" },
				{ mode = "n", lhs = "<S-j>", rhs = "<C-w>j" },
				{ mode = "n", lhs = "<S-k>", rhs = "<C-w>k" },
			}

			for _, map in ipairs(keymaps) do
				vim.api.nvim_buf_set_keymap(term.bufnr, map.mode, map.lhs, map.rhs, { noremap = true, silent = true })
			end

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
			pending_initial_text = nil
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
