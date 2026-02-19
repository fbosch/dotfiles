local M = {}

local cache_dir = vim.fn.stdpath("cache") .. "/copilot_usage"
local cache_file = cache_dir .. "/data.json"
local file_cache_enabled = vim.g.copilot_usage_file_cache ~= false

local cache = {
	data = nil,
	error = nil,
	last_update = 0,
	update_interval = 1800, -- 30 minutes
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

local function get_env(name)
	local value = os.getenv(name)
	if value and value ~= "" then
		return value
	end
	return nil
end

local function to_number(value)
	if type(value) == "number" then
		return value
	end
	if type(value) == "string" and value ~= "" then
		local num = tonumber(value)
		if num then
			return num
		end
	end
	return nil
end

local function color_for_percent(percent)
	if percent <= 50 then
		return "%#DiagnosticOk#"
	elseif percent <= 75 then
		return "%#DiagnosticWarn#"
	elseif percent <= 90 then
		return "%#WarningMsg#"
	end
	return "%#DiagnosticError#"
end

local function split_status_marker(result)
	if type(result) ~= "string" or result == "" then
		return result, nil
	end

	local body, status = result:match("^(.*)\n__HTTP_STATUS:(%d%d%d)%s*$")
	if body then
		return body, tonumber(status)
	end

	return result, nil
end

local function parse_snapshot(snapshot, label)
	if type(snapshot) ~= "table" then
		return nil
	end

	if snapshot.unlimited == true then
		return nil
	end

	local entitlement = to_number(snapshot.entitlement)
	local remaining = to_number(snapshot.remaining)
	local percent_remaining = to_number(snapshot.percent_remaining)

	local included = nil
	local used = nil
	local percent = nil

	if entitlement and remaining then
		included = math.max(entitlement, 0)
		used = entitlement - remaining
		if included > 0 then
			percent = math.floor((used / included) * 100)
		end
	end

	if not percent and percent_remaining then
		percent = math.floor(100 - percent_remaining)
	end

	if not used and included and percent then
		used = math.floor((percent / 100) * included)
	end

	if not used and not percent then
		return nil
	end

	if used and used < 0 then
		used = 0
	end

	return {
		label = label,
		used = used,
		included = included,
		percent = percent,
	}
end

local function parse_usage(decoded)
	if type(decoded) ~= "table" then
		return nil
	end

	local snapshots = decoded.quota_snapshots or decoded.quotaSnapshots
	local plan = decoded.copilot_plan or decoded.copilotPlan
	local reset = decoded.quota_reset_date or decoded.quotaResetDate

	local parsed = nil
	if type(snapshots) == "table" then
		parsed = parse_snapshot(snapshots.premium_interactions or snapshots.premiumInteractions, "premium")
			or parse_snapshot(snapshots.chat, "chat")
	end

	if not parsed and not plan then
		return nil
	end

	return {
		plan = plan,
		reset = reset,
		label = parsed and parsed.label or nil,
		used = parsed and parsed.used or nil,
		included = parsed and parsed.included or nil,
		percent = parsed and parsed.percent or nil,
	}
end

local function parse_and_cache(result)
	local body, http_status = split_status_marker(result)

	if http_status and http_status >= 400 then
		cache.data = nil
		cache.error = string.format("http_%d", http_status)
		cache.fetching = false
		return
	end

	local ok, decoded = pcall(vim.json.decode, body)
	if ok and decoded then
		cache.data = parse_usage(decoded)
		if cache.data then
			cache.last_update = os.time()
			save_cache_to_disk()
			cache.error = nil
		else
			cache.error = "parse"
		end
	else
		cache.data = nil
		cache.error = "decode"
	end
	cache.fetching = false
end

function M.fetch_data_async()
	local current_time = os.time()

	if cache.fetching or (cache.data and (current_time - cache.last_update) < cache.update_interval) then
		return
	end

	if vim.fn.executable("curl") ~= 1 then
		return
	end

	local token = get_env("GITHUB_TOKEN") or get_env("GH_TOKEN") or get_env("COPILOT_TOKEN")
	if not token then
		return
	end

	local url = "https://api.github.com/copilot_internal/user"

	cache.fetching = true

	local stdout = vim.loop.new_pipe(false)
	local handle
	handle = vim.loop.spawn("curl", {
		args = {
			"-sSL",
			"-H",
			"Accept: application/json",
			"-H",
			"Authorization: token " .. token,
			"-H",
			"Editor-Version: vscode/1.96.2",
			"-H",
			"Editor-Plugin-Version: copilot-chat/0.26.7",
			"-H",
			"User-Agent: GitHubCopilotChat/0.26.7",
			"-H",
			"X-Github-Api-Version: 2025-04-01",
			"-w",
			"\n__HTTP_STATUS:%{http_code}",
			url,
		},
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

function M.statusline_component()
	M.fetch_data_async()

	if not cache.data then
		if cache.error then
			return "%#Comment#copilot n/a"
		end
		return ""
	end

	local parts = { "%#Comment#copilot" }

	if cache.data.percent then
		local color = color_for_percent(cache.data.percent)
		table.insert(parts, string.format("%s%d%%%%%%*", color, cache.data.percent))
	end

	return table.concat(parts, " ")
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
