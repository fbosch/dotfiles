local format = require("utils.format")
local layout = require("utils.layout")
local web = require("utils.web")

local M = {}

local group = vim.api.nvim_create_augroup("Kagi", { clear = true })
local current_win = nil
local latest_response = nil
local previous_response = nil

local function get_kagi_token()
	local token = os.getenv("KAGI_API_TOKEN")
	if not token then
		vim.notify("Kagi API token not found", vim.log.levels.ERROR)
	end
	return token
end

local function with_progress(title)
	local fidget_available, progress = pcall(require, "fidget.progress")
	if fidget_available then
		return progress.handle.create({ title = title, lsp_client = { name = "Kagi" } })
	end
end

local function handle_result(result, opts)
	local progress_handle = opts and opts.progress_handle
	local prompt = opts and opts.prompt
	local cb = opts and opts.cb

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
	if decoded and decoded.error ~= nil then
		vim.schedule(function()
			if progress_handle then
				progress_handle:cancel()
			end
			vim.notify(decoded.error[1].message, vim.log.levels.ERROR)
			if prompt then
				vim.notify("Prompt: " .. prompt)
			end
		end)
		return
	end

	if progress_handle then
		vim.schedule(function()
			progress_handle:cancel()
		end)
	end

	if cb then
		cb(decoded and decoded.data or decoded)
	end
end

function M.summarize(url, cb)
	local token = get_kagi_token()
	if not token then
		return
	end

	local url_with_params =
		web.build_url("https://kagi.com/api/v0/summarize", { url = url, engine = "muriel", summary_type = "summary" })

	local cmd = {
		"curl",
		"-v",
		"-H",
		"Authorization: Bot " .. token,
		url_with_params,
	}

	local progress_handle = with_progress("summarizing")
	vim.system(cmd, {}, function(result)
		handle_result(result, {
			progress_handle = progress_handle,
			cb = cb,
		})
	end)
end

function M.fastgpt(prompt, cb)
	local token = get_kagi_token()
	if not token then
		return
	end

	local cmd = {
		"curl",
		"-H",
		"Authorization: Bot " .. token,
		"-H",
		"Content-Type: application/json",
		"-d",
		'{"query": "' .. prompt .. '"}',
		"https://kagi.com/api/v0/fastgpt",
	}
	local progress_handle = with_progress("fetching answer")

	vim.system(cmd, {}, function(result)
		handle_result(result, {
			progress_handle = progress_handle,
			prompt = prompt,
			cb = cb,
		})
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
	local lines = format.word_wrap(output_text, vim.o.columns * 0.36)
	vim.list_extend(lines, format_references(response.references))

	-- calculate the height of the window
	local num_lines = #lines
	local max_height = math.floor(vim.o.lines * 0.8)
	local min_height = 1
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

function M.prompt_fastgpt(default)
	local ok, Snacks = pcall(require, "snacks")

	local height = 1
	local row = layout.get_centered_row_col(height, width) - 5

	if ok then
		local input = Snacks.input({
			icon = "󰒊 ",
			icon_hl = "SnacksIcon",
			icon_pos = "right",
			prompt = "",
			default = default or "",
			win = {
				style = "scratch",
				height = height,
				border = "solid",
				backdrop = { transparent = true, blend = 60 },
				title_pos = "right",
				row = row,
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

function M.summarize_nearest_url()
	local line = vim.fn.getline(".")
	local url = line:match("https?://[%w-_%.%?%.:/%+=&%%#@%!]+")
	if not url then
		vim.notify("No URL found", vim.log.levels.WARN)
		return
	end

	M.summarize(url, function(response)
		vim.schedule(function()
			show_response(response)
		end)
	end)
end

return M
