local git = require("utils.git")
local format = require("utils.format")
local layout = require("utils.layout")
local web = require("utils.web")
local fn = require("utils.fn")
local platform = require("utils.platform")

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

local function get_price_of_tokens(tokens)
	tokens = tonumber(tokens)
	local price_usd = tokens * 0.00003
	return string.format("$%.2f", price_usd)
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
			vim.notify(decoded.error[1].msg, vim.log.levels.ERROR)
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
		web.build_url("https://kagi.com/api/v0/summarize", { url = url, engine = "cecil", summary_type = "summary" })

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

local function show_response(title, response)
	latest_response = response
	previous_response = response

	-- format the output text
	local output_text = format_output_text(response.output)
	local lines = format.word_wrap(output_text, vim.o.columns * 0.28)
	vim.list_extend(lines, format_references(response.references))

	-- calculate the height of the window
	local num_lines = #lines
	local max_height = math.floor(vim.o.lines * 0.8)
	local min_height = 5
	local height = math.max(math.min(num_lines, max_height), min_height)

	-- close the current window if it exists
	if current_win ~= nil then
		current_win:close()
	end

	current_win = Snacks.win({
		name = "FastGPT",
		title = title .. " (" .. get_price_of_tokens(response.tokens) .. ")",
		title_pos = "right",
		style = "help",
		backdrop = false,
		border = "rounded",
		fix_buf = true,
		text = lines,
		width = 0.3,
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
					show_response(title, latest_response)
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
	show_response("Previous response", previous_response)
end

local function resolve_bang_url(query)
	local engine, raw
	-- Try prefix bang
	local e, r = query:match("^!(%S+)%s*(.*)")
	if e then
		engine, raw = e, r
	else
		-- Try suffix bang
		local r2, e2 = query:match("^(.-)%s+!(%S+)$")
		if e2 then
			engine, raw = e2, r2
		end
	end

	raw = vim.trim(raw or query)
	local q = vim.trim(web.url_encode(raw or query))
	local git_remote_url = git.get_remote_url()
	local azure_org_url = git.extract_azure_org(git_remote_url)
	local default = "https://kagi.com/search?q=" .. web.url_encode(query)

	return fn.switch(engine, {
		az = function()
			if azure_org_url then
				if q:match("^%d+$") then
					-- if number, treat as work item ID
					return azure_org_url .. "/_workitems/edit/" .. q
				elseif q:match("wiki") then
					-- if wiki, treat as wiki search
					return azure_org_url .. "/_search?text=" .. q .. "&type=wiki"
				else
					-- Standard search
					return azure_org_url .. "/_search?text=" .. q .. "&type=workitem"
				end
			end
			vim.notify("Azure DevOps URL not found", vim.log.levels.WARN)
			return default
		end,
		default = default,
	})
end

function M.search(query)
	if not query then
		vim.notify("No query provided", vim.log.levels.WARN)
		return
	end

	platform.system_open(resolve_bang_url(query))
end

function M.search_query(default)
	local ok, Snacks = pcall(require, "snacks")
	if not ok then
		vim.notify("Snacks not found.", vim.log.levels.ERROR)
		return
	end
	vim.loop.getaddrinfo("kagi.com", nil, {}, function() end) -- DNS prefetch
	local row = layout.get_centered_row_col(1) - 5
	local input = Snacks.input({
		icon = " ",
		prompt = "",
		default = default or "",
		win = {
			border = "solid",
			backdrop = { transparent = true, blend = 60 },
			title_pos = "right",
			row = row,
		},
	}, function(prompt)
		M.search(prompt)
		vim.notify("Opening browser...", vim.log.levels.INFO)
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

function M.prompt_fastgpt(default)
	local ok, Snacks = pcall(require, "snacks")
	if not ok then
		vim.notify("Snacks not found.", vim.log.levels.ERROR)
		return
	end

	local row = layout.get_centered_row_col(1) - 5
	local input = Snacks.input({
		icon = "󰒊 ",
		prompt = "",
		default = default or "",
		win = {
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
				show_response(prompt, response)
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

function M.summarize_nearest_url()
	local line = vim.fn.getline(".")
	local url = line:match("https?://[%w-_%.%?%.:/%+=&%%#@%!]+")
	if not url then
		vim.notify("No URL found", vim.log.levels.WARN)
		return
	end

	M.summarize(url, function(response)
		vim.schedule(function()
			show_response(url, response)
		end)
	end)
end

return M
