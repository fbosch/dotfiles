local M = {}

local cache_dir = vim.fn.stdpath("cache") .. "/codexbar"
local cache_file = cache_dir .. "/data.json"
local auth_file = vim.fn.expand("~/.codex/auth.json")
local file_cache_enabled = vim.g.codexbar_file_cache ~= false

local alias_map = {
	["indigo-harbor-ddce"] = "fbb",
	["atlas-thicket-3afa"] = "jpb",
	["aurora-auroraforge-efd2"] = "work",
}

local adjectives = {
	"ember",
	"cobalt",
	"amber",
	"jade",
	"coral",
	"indigo",
	"silver",
	"scarlet",
	"atlas",
	"lotus",
	"cedar",
	"pine",
	"aurora",
	"frost",
	"orbit",
	"dune",
	"maple",
	"zenith",
}

local nouns = {
	"falcon",
	"otter",
	"comet",
	"harbor",
	"meadow",
	"emberfox",
	"lynx",
	"kestrel",
	"glacier",
	"thicket",
	"river",
	"moss",
	"canyon",
	"beacon",
	"auroraforge",
	"wave",
	"ridge",
}

local cache = {
	data = nil,
	profile = nil,
	profile_account_id = nil,
	profile_mtime = nil,
	profile_last_update = 0,
	profile_check_interval = 1,
	reset_count = nil,
	reset_account_id = nil,
	reset_nearest_expiry = nil,
	reset_expiry_known = false,
	reset_last_update = 0,
	reset_fetching = false,
	reset_update_interval = 8 * 60 * 60,
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
		if ok and decoded then
			if decoded.data and decoded.last_update then
				cache.data = decoded.data
				cache.last_update = decoded.last_update
			end

			if type(decoded.reset_account_id) == "string" and type(decoded.reset_last_update) == "number" then
				cache.reset_account_id = decoded.reset_account_id
				cache.reset_last_update = decoded.reset_last_update
				cache.reset_count = tonumber(decoded.reset_count)
				cache.reset_nearest_expiry = type(decoded.reset_nearest_expiry) == "string" and decoded.reset_nearest_expiry or nil
				cache.reset_expiry_known = decoded.reset_expiry_known == true
			end

			return cache.data ~= nil or cache.reset_account_id ~= nil
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
		reset_account_id = cache.reset_account_id,
		reset_count = cache.reset_count,
		reset_nearest_expiry = cache.reset_nearest_expiry,
		reset_expiry_known = cache.reset_expiry_known,
		reset_last_update = cache.reset_last_update,
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

local function parse_and_cache_reset_count(result, account_id)
	cache.reset_last_update = os.time()
	cache.reset_fetching = false

	local ok, decoded = pcall(vim.json.decode, result)
	local count = ok and type(decoded) == "table" and tonumber(decoded.available_count)
	if not count then
		return
	end

	cache.reset_account_id = account_id
	cache.reset_count = math.max(0, math.floor(count))
	cache.reset_nearest_expiry = nil
	cache.reset_expiry_known = true
	for _, credit in ipairs(decoded.credits or {}) do
		if credit.status == "available" and type(credit.expires_at) == "string" then
			if not cache.reset_nearest_expiry or credit.expires_at < cache.reset_nearest_expiry then
				cache.reset_nearest_expiry = credit.expires_at
			end
		end
	end
	save_cache_to_disk()
end

local function read_auth_tokens()
	local file = io.open(auth_file, "r")
	if not file then
		return nil
	end

	local content = file:read("*a")
	file:close()
	if not content or content == "" then
		return nil
	end

	local ok, decoded = pcall(vim.json.decode, content)
	local tokens = ok and decoded and decoded.tokens
	if type(tokens) ~= "table" then
		return nil
	end

	if type(tokens.account_id) ~= "string" or tokens.account_id == "" then
		return nil
	end

	if type(tokens.access_token) ~= "string" or tokens.access_token == "" then
		return nil
	end

	return tokens
end

local function fetch_reset_count_async(account_id)
	if not account_id then
		return
	end

	local current_time = os.time()
	local has_legacy_reset_cache = cache.reset_count ~= nil and not cache.reset_expiry_known
	if cache.reset_fetching or (cache.reset_account_id == account_id and not has_legacy_reset_cache and (current_time - cache.reset_last_update) < cache.reset_update_interval) then
		return
	end

	local tokens = read_auth_tokens()
	if not tokens or tokens.account_id ~= account_id then
		return
	end

	cache.reset_fetching = true
	cache.reset_account_id = tokens.account_id
	cache.reset_count = nil
	cache.reset_expiry_known = false

	local stdout = vim.loop.new_pipe(false)
	local handle
	handle = vim.loop.spawn("curl", {
		args = {
			"--silent",
			"--show-error",
			"--connect-timeout",
			"5",
			"--max-time",
			"10",
			"--header",
			"Authorization: Bearer " .. tokens.access_token,
			"--header",
			"ChatGPT-Account-Id: " .. tokens.account_id,
			"https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
		},
		stdio = { nil, stdout, nil },
	}, function()
		if stdout and not stdout:is_closing() then
			stdout:close()
		end
		if handle and not handle:is_closing() then
			handle:close()
		end
	end)

	if not handle then
		if stdout and not stdout:is_closing() then
			stdout:close()
		end
		cache.reset_last_update = current_time
		cache.reset_fetching = false
		return
	end

	local result = ""
	stdout:read_start(function(err, data)
		if err then
			cache.reset_last_update = os.time()
			cache.reset_fetching = false
			return
		end
		if data then
			result = result .. data
		else
			vim.schedule(function()
				parse_and_cache_reset_count(result, tokens.account_id)
			end)
		end
	end)
end

function M.fetch_data_async(account_id)
	local current_time = os.time()
	fetch_reset_count_async(account_id)

	if cache.fetching or (cache.data and (current_time - cache.last_update) < cache.update_interval) then
		return
	end

	if vim.fn.executable("codexbar") ~= 1 then
		return
	end

	cache.fetching = true
	local args = { "usage", "--source", "oauth", "--provider", "codex", "--json" }

	local stdout = vim.loop.new_pipe(false)
	local handle
	handle = vim.loop.spawn("codexbar", {
		args = args,
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

	local normalized = resets_at:gsub("%.%d+Z$", "Z")
	local reset_ts = vim.fn.strptime("%Y-%m-%dT%H:%M:%SZ", normalized)
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

local function color_for_reset_expiry(expires_at)
	if not expires_at or expires_at == "" then
		return "%#NonText#"
	end

	local normalized = expires_at:gsub("%.%d+Z$", "Z")
	local expiry_ts = vim.fn.strptime("%Y-%m-%dT%H:%M:%SZ", normalized)
	if expiry_ts == 0 then
		return "%#NonText#"
	end

	local seconds_remaining = expiry_ts - os.time(os.date("!*t"))
	if seconds_remaining <= 24 * 60 * 60 then
		return "%#DiagnosticError#"
	end
	if seconds_remaining <= 7 * 24 * 60 * 60 then
		return "%#DiagnosticWarn#"
	end
	return "%#NonText#"
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

local function nilify(value)
	if value == vim.NIL then
		return nil
	end
	return value
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

local function build_profile_label(account_id)
	local seed_hex = account_id:gsub("[^0-9a-fA-F]", "")
	if seed_hex == "" then
		seed_hex = "00"
	end

	local adjective_index = (tonumber(seed_hex:sub(1, 2), 16) or 0) % #adjectives + 1
	local noun_index = (tonumber(seed_hex:sub(3, 4), 16) or 0) % #nouns + 1
	local id_tail = account_id:sub(math.max(1, #account_id - 3))
	local generated_label = string.format("%s-%s-%s", adjectives[adjective_index], nouns[noun_index], id_tail)

	return alias_map[generated_label] or generated_label
end

local function read_profile_label()
	local tokens = read_auth_tokens()
	if not tokens then
		return nil
	end

	return build_profile_label(tokens.account_id), tokens.account_id
end

local function profile_label()
	local current_time = os.time()
	if cache.profile_last_update > 0 and (current_time - cache.profile_last_update) < cache.profile_check_interval then
		return cache.profile, cache.profile_account_id
	end

	cache.profile_last_update = current_time
	local mtime = vim.fn.getftime(auth_file)
	if mtime == cache.profile_mtime then
		return cache.profile, cache.profile_account_id
	end

	cache.profile_mtime = mtime
	if mtime < 0 then
		cache.profile = nil
		cache.profile_account_id = nil
		return nil, nil
	end

	cache.profile, cache.profile_account_id = read_profile_label()
	return cache.profile, cache.profile_account_id
end

function M.statusline_component()
	local ok, result = pcall(function()
		local parts = {}
		local profile, profile_account_id = profile_label()
		M.fetch_data_async(profile_account_id)
		if profile then
			table.insert(parts, string.format("%%#NonText#%s%%*", profile))
			if cache.reset_account_id == profile_account_id and cache.reset_count ~= nil then
				table.insert(parts, string.format("%s(%d)%%*", color_for_reset_expiry(cache.reset_nearest_expiry), cache.reset_count))
			end
		end

		if not cache.data or not cache.data.usage then
			return table.concat(parts, " ")
		end

		local secondary = nilify(cache.data.usage.secondary)
		local secondary_remaining = secondary and remaining_percent(secondary.usedPercent) or nil

		local show_primary = true
		if secondary_remaining == 0 then
			show_primary = false
		end

		if show_primary then
			local primary = nilify(cache.data.usage.primary)
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
			-- If showing only the secondary bar and it's 0%, make it dim instead of red
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

function M.clear_cache()
	cache.data = nil
	cache.profile = nil
	cache.profile_account_id = nil
	cache.profile_mtime = nil
	cache.profile_last_update = 0
	cache.reset_count = nil
	cache.reset_account_id = nil
	cache.reset_nearest_expiry = nil
	cache.reset_expiry_known = false
	cache.reset_last_update = 0
	cache.reset_fetching = false
	cache.last_update = 0
	cache.fetching = false

	if file_cache_enabled then
		pcall(vim.fn.delete, cache_file)
	end

	M.fetch_data_async()
end

vim.defer_fn(function()
	local _, account_id = profile_label()
	M.fetch_data_async(account_id)
end, 100)

return M
