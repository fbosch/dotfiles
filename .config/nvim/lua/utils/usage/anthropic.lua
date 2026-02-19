local M = {}

local cache_dir = vim.fn.stdpath("cache") .. "/anthropic_usage"
local cache_file = cache_dir .. "/data.json"
local file_cache_enabled = vim.g.anthropic_usage_file_cache ~= false

local cache = {
	data = nil,
	last_update = 0,
	update_interval = 600, -- 10 minutes
	fetching = false,
}

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

local function parse_and_cache(result)
	if result and result ~= "" then
		local ok, decoded = pcall(vim.json.decode, result)
		if ok and decoded and decoded[1] then
			cache.data = decoded[1]
			cache.last_update = os.time()
			save_cache_to_disk()
		end
	end
	cache.fetching = false
end

function M.fetch_data_async()
	local current_time = os.time()

	if cache.fetching or (cache.data and (current_time - cache.last_update) < cache.update_interval) then
		return
	end

	if vim.fn.executable("codexbar") ~= 1 then
		return
	end

	cache.fetching = true

	local stdout = vim.loop.new_pipe(false)
	local handle
	handle = vim.loop.spawn("codexbar", {
		args = { "--source", "cli", "--provider", "claude", "--json" },
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

local function safe_percent(value)
	local num = tonumber(value) or 0
	if num < 0 then
		return 0
	end
	if num > 100 then
		return 100
	end
	return math.floor(num)
end

local function remaining_percent(used_percent)
	local remaining = 100 - safe_percent(used_percent)
	if remaining < 0 then
		return 0
	end
	if remaining > 100 then
		return 100
	end
	return remaining
end

local function format_countdown(resets_at)
	if not resets_at or resets_at == "" then
		return nil
	end

	local reset_ts = vim.fn.strptime("%Y-%m-%dT%H:%M:%SZ", resets_at)
	if reset_ts == 0 then
		return nil
	end

	local now_ts = os.time(os.date("!*t"))
	local diff = reset_ts - now_ts
	if diff <= 0 then
		return "now"
	end

	local hours = math.floor(diff / 3600)
	if hours < 1 then
		local mins = math.floor(diff / 60)
		if mins < 1 then
			mins = 1
		end
		return string.format("~%dm", mins)
	end

	if hours < 24 then
		return string.format("~%dh", hours)
	end

	local days = math.floor(hours / 24)
	return string.format("~%dd", days)
end

local function color_for_percent(percent)
	if percent >= 75 then
		return "%#DiagnosticOk#"
	elseif percent >= 50 then
		return "%#DiagnosticWarn#"
	elseif percent >= 25 then
		return "%#WarningMsg#"
	end
	return "%#DiagnosticError#"
end

local function generate_bar(percent, width)
	width = width or 9
	local filled = math.floor((percent / 100) * width)
	if filled < 1 and percent > 0 then
		filled = 1
	end

	local filled_char = "▂"
	local empty_char = "▁"

	return string.rep(filled_char, filled), string.rep(empty_char, width - filled)
end

function M.statusline_component()
	M.fetch_data_async()

	local ok, result = pcall(function()
		if not cache.data or not cache.data.usage then
			return ""
		end

		local parts = {}
		table.insert(parts, "%#Comment#claude")

		local secondary = cache.data.usage.secondary
		local secondary_remaining = secondary and remaining_percent(secondary.usedPercent) or nil

		local show_primary = true
		if secondary_remaining == 0 then
			show_primary = false
		end

		if show_primary then
			local primary = cache.data.usage.primary
			if primary then
				local percent = remaining_percent(primary.usedPercent)
				local filled_bar, empty_bar = generate_bar(percent, 9)
				local color = color_for_percent(percent)
				local countdown = format_countdown(primary.resetsAt)
				table.insert(
					parts,
					string.format(
						"%s%s%%*%s%s%%* %s%d%%%%%%*",
						color,
						filled_bar,
						"%#Comment#",
						empty_bar,
						color,
						percent
					)
				)
				if countdown then
					table.insert(parts, string.format("%%#NonText#%s", countdown))
				end
			end
		end

		if secondary then
			local percent = secondary_remaining or remaining_percent(secondary.usedPercent)
			local filled_bar, empty_bar = generate_bar(percent, 9)
			local color
			if not show_primary and percent == 0 then
				color = "%#Comment#"
			else
				color = color_for_percent(percent)
			end
			local countdown = format_countdown(secondary.resetsAt)
			table.insert(
				parts,
				string.format("%s%s%%*%s%s%%* %s%d%%%%%%*", color, filled_bar, "%#Comment#", empty_bar, color, percent)
			)
			if countdown then
				table.insert(parts, string.format("%%#NonText#%s", countdown))
			end
		end

		return table.concat(parts, " ")
	end)

	if ok then
		return result
	end

	return ""
end

load_cache_from_disk()

vim.defer_fn(function()
	M.fetch_data_async()
end, 100)

return M
