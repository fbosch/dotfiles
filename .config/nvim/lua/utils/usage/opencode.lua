local M = {}

local cache_dir = vim.fn.stdpath("cache") .. "/opencode_zen_stats"
local cache_file = cache_dir .. "/data.json"
local file_cache_enabled = vim.g.opencode_zen_stats_file_cache ~= false

local cache = {
	data = nil,
	error = nil,
	last_update = 0,
	update_interval = 1800, -- 30 minutes
	fetching = false,
}

local function month_to_date_days()
	local now = os.date("*t")
	return now.day or 30
end

local function color_for_cost(cost, cap)
	if not cap or cap <= 0 then
		return "%#Comment#"
	end

	if cost > cap then
		return "%#DiagnosticError#"
	end

	if cost >= (cap * 0.9) then
		return "%#WarningMsg#"
	end

	return "%#Comment#"
end

local function ensure_cache_dir()
	if vim.fn.isdirectory(cache_dir) == 0 then
		vim.fn.mkdir(cache_dir, "p")
	end
end

local function load_cache_from_disk()
	if not file_cache_enabled then
		return false
	end

	local file = io.open(cache_file, "r")
	if not file then
		return false
	end

	local content = file:read("*a")
	file:close()

	if content and content ~= "" then
		local ok, decoded = pcall(vim.json.decode, content)
		if ok and decoded and decoded.data and decoded.last_update then
			cache.data = decoded.data
			cache.last_update = decoded.last_update
			return true
		end
	end

	return false
end

local function save_cache_to_disk()
	if not file_cache_enabled then
		return
	end

	ensure_cache_dir()

	local cache_content = {
		data = cache.data,
		last_update = cache.last_update,
	}

	local ok, encoded = pcall(vim.json.encode, cache_content)
	if not ok then
		return
	end

	local file = io.open(cache_file, "w")
	if file then
		file:write(encoded)
		file:close()
	end
end

local function strip_ansi(text)
	return text:gsub("\27%[[0-9;]*[%a]", "")
end

local function parse_money(value)
	if not value then
		return nil
	end
	value = value:gsub(",", "")
	return tonumber(value)
end

local function parse_stats_output(result)
	if not result or result == "" then
		return nil
	end

	local zen_cost = 0
	local zen_models = 0
	local in_zen_model = false

	for line in result:gmatch("[^\r\n]+") do
		line = strip_ansi(line)

		local model_header = line:match("^%s*│%s*([%w._-]+/[%w._-]+)%s*│%s*$")
		if model_header then
			in_zen_model = model_header:match("^opencode/") ~= nil
		end

		if in_zen_model then
			local cost = parse_money(line:match("│%s*Cost%s+%$([0-9,%.]+)%s*│"))
			if cost then
				zen_cost = zen_cost + cost
				zen_models = zen_models + 1
				in_zen_model = false
			end
		end
	end

	if zen_models == 0 then
		return nil
	end

	return {
		cost = zen_cost,
		models = zen_models,
	}
end

local function parse_and_cache(result)
	cache.data = parse_stats_output(result)
	if cache.data then
		cache.last_update = os.time()
		save_cache_to_disk()
		cache.error = nil
	else
		cache.error = "parse"
	end
	cache.fetching = false
end

function M.fetch_data_async()
	local current_time = os.time()

	if cache.fetching or (cache.data and (current_time - cache.last_update) < cache.update_interval) then
		return
	end

	if vim.fn.executable("opencode") ~= 1 then
		return
	end

	local days = tonumber(vim.g.opencode_zen_stats_days) or month_to_date_days()

	cache.fetching = true

	local stdout = vim.loop.new_pipe(false)
	local handle
	handle = vim.loop.spawn("opencode", {
		args = { "stats", "--days", tostring(days), "--models" },
		stdio = { nil, stdout, nil },
	}, function()
		if stdout and not stdout:is_closing() then
			stdout:close()
		end
		if handle and not handle:is_closing() then
			handle:close()
		end
		cache.fetching = false
	end)

	if not handle then
		if stdout and not stdout:is_closing() then
			stdout:close()
		end
		cache.fetching = false
		return
	end

	local result = ""
	stdout:read_start(function(err, data)
		if err then
			cache.fetching = false
			cache.error = "read"
			return
		end
		if data then
			result = result .. data
		else
			vim.schedule(function()
				parse_and_cache(result)
			end)
		end
	end)
end

function M.statusline_component()
	M.fetch_data_async()

	if not cache.data then
		return ""
	end

	local cap = tonumber(vim.g.opencode_zen_monthly_cap) or 40
	local color = color_for_cost(cache.data.cost, cap)
	return string.format("%%#Comment#zen %s~$%.0f%%*", color, cache.data.cost)
end

function M.clear_cache()
	cache.data = nil
	cache.error = nil
	cache.last_update = 0
	cache.fetching = false

	if file_cache_enabled then
		pcall(vim.fn.delete, cache_file)
	end

	M.fetch_data_async()
end

vim.defer_fn(function()
	M.fetch_data_async()
end, 100)

load_cache_from_disk()

return M
