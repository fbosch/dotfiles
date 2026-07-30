local wezterm = require("wezterm")
local palette = require("theme")

local usage = { checked_at = 0, windows = {} }
local usage_cache = (os.getenv("XDG_CACHE_HOME") or ((os.getenv("HOME") or "") .. "/.cache"))
	.. "/wezterm/codex-usage.json"
local reset_credits = { checked_at = 0 }
local fish_libexec_dir = (os.getenv("HOME") or "") .. "/.config/fish/libexec"
local reset_helper = fish_libexec_dir .. "/codex/reset_helper.ts"
local command_path = table.concat({
	-- Home Manager exposes user packages here on macOS and NixOS.
	"/etc/profiles/per-user/" .. (os.getenv("USER") or "") .. "/bin",
	-- nix-darwin manages codexbar through Homebrew on macOS.
	"/opt/homebrew/bin",
	"/usr/local/bin",
	"/run/current-system/sw/bin",
	"$PATH",
}, ":")

local function usage_color(remaining)
	if remaining >= 75 then
		return palette.ansi.green
	end
	if remaining >= 50 then
		return palette.semantic.attention
	end
	if remaining >= 25 then
		return palette.ansi.yellow
	end
	return palette.semantic.critical
end

local function parse_utc_timestamp(value)
	local year, month, day, hour, minute, second = value:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)")
	if year == nil then
		return nil
	end

	local local_timestamp = os.time({
		year = tonumber(year),
		month = tonumber(month),
		day = tonumber(day),
		hour = tonumber(hour),
		min = tonumber(minute),
		sec = tonumber(second),
	})
	local offset = os.difftime(os.time(os.date("*t")), os.time(os.date("!*t")))
	return local_timestamp + offset
end

local function format_countdown(resets_at)
	if type(resets_at) ~= "string" then
		return nil
	end

	local reset_timestamp = parse_utc_timestamp(resets_at)
	if reset_timestamp == nil then
		return nil
	end

	local seconds = reset_timestamp - os.time()
	if seconds <= 0 then
		return "now"
	end
	if seconds < 3600 then
		return string.format("~%dm", math.max(1, math.floor(seconds / 60)))
	end
	if seconds < 86400 then
		return string.format("~%dh", math.floor(seconds / 3600))
	end
	return string.format("~%dd", math.floor(seconds / 86400))
end

local function get_reset_credits()
	if os.time() - reset_credits.checked_at >= 10 * 60 then
		reset_credits.checked_at = os.time()
		reset_credits.profile = nil
		reset_credits.count = nil
		reset_credits.expires_at = nil
		local ok, stdout = wezterm.run_child_process({
			"/bin/sh",
			"-c",
			string.format(
				"PATH=%q; export PATH; exec bun --cwd %q %q credits",
				command_path,
				fish_libexec_dir,
				reset_helper
			),
		})
		local parsed_ok, data = false, nil
		if ok then
			parsed_ok, data = pcall(wezterm.json_parse, stdout)
		end
		if
			parsed_ok
			and type(data) == "table"
			and type(data.accountId) == "string"
			and type(data.profileLabel) == "string"
			and tonumber(data.availableCount)
		then
			reset_credits.profile = data.profileLabel
			reset_credits.count = math.max(0, math.floor(tonumber(data.availableCount)))
			reset_credits.expires_at = data.expiresAt
		end
	end

	return reset_credits.profile, reset_credits.count, reset_credits.expires_at
end

local function reset_credit_color(expires_at)
	local expires_timestamp = type(expires_at) == "string" and parse_utc_timestamp(expires_at) or nil
	if expires_timestamp == nil then
		return palette.semantic.muted
	end

	local seconds = expires_timestamp - os.time()
	if seconds <= 24 * 60 * 60 then
		return palette.semantic.critical
	end
	if seconds <= 7 * 24 * 60 * 60 then
		return palette.semantic.attention
	end
	return palette.semantic.muted
end

local function get_usage()
	local now = os.time()
	local cache_file = io.open(usage_cache, "r")
	local content = cache_file and cache_file:read("*a") or ""
	if cache_file then
		cache_file:close()
	end

	local parsed_ok, response = pcall(wezterm.json_parse, content)
	local data = parsed_ok and response and response[1] and response[1].usage
	if type(data) == "table" then
		usage.windows = {}
		for _, window in ipairs({ data.primary or false, data.secondary or false }) do
			local used_percent = type(window) == "table" and tonumber(window.usedPercent) or nil
			if used_percent then
				local remaining = math.max(0, math.min(100, 100 - math.floor(used_percent)))
				table.insert(usage.windows, {
					color = usage_color(remaining),
					remaining = remaining,
					resets_at = window.resetsAt,
				})
			end
		end
	end

	if now - usage.checked_at >= 600 then
		usage.checked_at = now
		wezterm.background_child_process({
			"/bin/sh",
			"-c",
			string.format(
				'PATH=%q; export PATH; mkdir -p %q && temporary=%q.$$ && codexbar usage --source cli --provider codex --json >"$temporary" && mv "$temporary" %q',
				command_path,
				usage_cache:match("^(.+)/[^/]+$"),
				usage_cache,
				usage_cache
			),
		})
	end

	return usage.windows
end

local function append(items)
	local windows = get_usage()
	local profile, reset_count, reset_expires_at = get_reset_credits()
	if profile == nil and #windows == 0 then
		return
	end

	if profile then
		table.insert(items, { Foreground = { Color = palette.semantic.muted } })
		table.insert(items, { Text = profile })
		if reset_count ~= nil then
			table.insert(items, { Foreground = { Color = reset_credit_color(reset_expires_at) } })
			table.insert(items, { Text = " (" .. reset_count .. ") " })
		else
			table.insert(items, { Text = " " })
		end
	end

	for index, window in ipairs(windows) do
		local window_color = (#windows == 1 and window.remaining == 0) and palette.semantic.muted or window.color
		local filled = math.floor(window.remaining * 9 / 100)
		if window.remaining > 0 and filled == 0 then
			filled = 1
		end
		table.insert(items, { Foreground = { Color = window_color } })
		table.insert(items, { Text = string.rep("▂", filled) })
		table.insert(items, { Foreground = { Color = palette.semantic.muted } })
		table.insert(items, { Text = string.rep("▁", 9 - filled) .. " " })
		table.insert(items, { Foreground = { Color = window_color } })
		table.insert(items, { Text = window.remaining .. "%" })
		local countdown = format_countdown(window.resets_at)
		if countdown then
			table.insert(items, { Foreground = { Color = palette.semantic.muted } })
			table.insert(items, { Text = " " .. countdown })
		end
		if index < #windows then
			table.insert(items, { Foreground = { Color = palette.semantic.muted } })
			table.insert(items, { Text = " " })
		end
	end

	table.insert(items, { Text = " " })
	table.insert(items, { Foreground = { Color = palette.semantic.separator } })
	table.insert(items, { Text = "▏" })
end

local function handle_user_var(name)
	if name == "codex_profile_changed" then
		usage.checked_at = 0
		usage.windows = {}
		reset_credits.checked_at = 0
		return true
	end
	if name == "codex_reset_refreshed" then
		usage.checked_at = 0
		usage.windows = {}
		reset_credits.checked_at = 0
		return true
	end
	return false
end

return {
	append = append,
	handle_user_var = handle_user_var,
}
