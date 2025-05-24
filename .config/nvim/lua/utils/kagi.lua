local utils = require("utils")
local fn = require("utils.fn")
local M = {}

local instruction_prompt = ""

local group = vim.api.nvim_create_augroup("Kagi", { clear = true })

local current_win = nil
local latest_response = nil
local previous_response = nil

function M.fastgpt(prompt, cb)
	local token = os.getenv("KAGI_API_TOKEN")
	if token == nil then
		vim.notify("Kagi API token not found", vim.log.levels.ERROR)
	end

	local cmd = {
		"curl",
		"-H",
		"Authorization: Bot " .. token,
		"-H",
		"Content-Type: application/json",
		"-d",
		'{"query": "' .. instruction_prompt .. prompt .. '"}',
		"https://kagi.com/api/v0/fastgpt",
	}
	local fidget_available, progress = pcall(require, "fidget.progress")
	local progress_handle

	if fidget_available then
		progress_handle = progress.handle.create({ title = "fetching answer", lsp_client = { name = "Kagi" } })
	end

	vim.system(cmd, {}, function(result)
		if result.code ~= 0 then
			vim.schedule(function()
				if progress_handle then
					progress_handle:cancel()
				end
				vim.notify("Kagi API error: " .. result.stderr, vim.log.levels.ERROR)
			end)
			return
		end

		local decoded = vim.json.decode(result.stdout, { object = true, array = true })
		if decoded.error ~= nil then
			vim.schedule(function()
				if progress_handle then
					progress_handle:cancel()
				end
				vim.notify(decoded.error[1].message, vim.log.levels.ERROR)
				vim.notify("Prompt:", prompt)
			end)
		end

		cb(decoded.data)
	end)
end

local function format_output_text(output)
	return output:gsub("【(%d+)】", "[%1]")
end

local function format_references(references)
	if not references or #references == 0 then
		return {}
	end
	local lines = { "", "References:" }
	for i, ref in ipairs(references) do
		local line = string.format("[%d] [%s](%s)", i, ref.title or ref.url, ref.url)
		table.insert(lines, line)
	end
	return lines
end

local function show_response(response)
	latest_response = response
	previous_response = response

	-- format the output text
	local output_text = format_output_text(response.output)
	local lines = fn.word_wrap(output_text, vim.o.columns * 0.36)
	vim.list_extend(lines, format_references(response.references))

	-- calculate the height of the window
	local num_lines = #lines
	local max_height = math.floor(vim.o.lines * 0.8)
	local min_height = 4
	local height = math.max(math.min(num_lines, max_height), min_height) + 2

	-- close the current window if it exists
	if current_win ~= nil then
		current_win:close()
	end

	current_win = Snacks.win({
		name = "FastGPT",
		style = "help",
		backdrop = false,
		border = "rounded",
		fix_buf = true,
		text = lines,
		width = 0.4,
		height = height,
		col = -3,
		row = -3,
		ft = "markdown",
		wo = {
			wrap = true,
		},
		bo = {
			filetype = "markdown",
		},
	})

	vim.api.nvim_create_autocmd({ "BufLeave", "BufDelete" }, {
		buffer = current_win.bufnr,
		once = true,
		group = group,
		callback = function()
			current_win:destroy()
			current_win = nil
			latest_response = nil
		end,
	})

	vim.api.nvim_create_autocmd({ "VimResized" }, {
		group = group,
		once = true,
		callback = function()
			vim.schedule(function()
				if latest_response ~= nil then
					show_response(latest_response)
				end
			end)
		end,
	})
end

function M.show_previous_response()
	if previous_response == nil then
		vim.notify("No previous response", vim.log.levels.INFO)
		return
	end
	show_response(previous_response)
end

function M.ask(default)
	local ok, Snacks = pcall(require, "snacks")
	if ok then
		local input = Snacks.input({
			icon = "󰒊 ",
			icon_hl = "SnacksIcon",
			icon_pos = "right",
			prompt = "FastGPT",
			noautocmd = false,
			default = default or "",
			win = {
				style = "scratch",
				height = 1,
				border = "solid",
				backdrop = { transparent = true, blend = 60 },
				title_pos = "right",
				row = 20,
			},
		}, function(prompt)
			if prompt == nil or prompt == "" then
				return
			end

			M.fastgpt(prompt, function(response)
				vim.schedule(function()
					show_response(response)
				end)
			end)
		end)

		-- auto-close the input window when the buffer is closed
		vim.api.nvim_create_autocmd({ "BufLeave", "BufDelete" }, {
			buffer = input.bufnr,
			once = true,
			group = group,
			callback = function()
				input:close()
			end,
		})
	end
end

return M
