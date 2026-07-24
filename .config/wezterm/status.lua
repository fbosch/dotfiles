local is_windows = package.config:sub(0, 1) == "\\"
local wezterm = require("wezterm")
local agent_deck = require("agent")
local herdr = require("agent.herdr")
local theme = require("theme")
local time_utils = require("utils.time")

-- Pre-allocate color tables to reduce allocations
local color_gray = { Color = theme.base.fg_muted }
local color_separator = { Color = theme.base.separator }
local color_white = { Color = theme.base.fg }
local color_waiting = { Color = theme.agent.waiting }
local color_workhours_start = { Color = "#999999" }
local color_workhours_half = { Color = "#B77E64" }
local color_workhours_end = { Color = "#d2af0d" }
local color_workhours_good = { Color = "#819B69" }
local color_workhours_over = { Color = "#d79999" }
local color_usage_good = { Color = "#819B69" }
local color_usage_warn = { Color = "#d2af0d" }
local color_usage_caution = { Color = "#B77E64" }
local color_usage_critical = { Color = "#d79999" }
local profile_aliases = {
	["indigo-harbor-ddce"] = "fbb",
	["atlas-thicket-3afa"] = "jpb",
	["aurora-auroraforge-efd2"] = "work",
}
local profile_adjectives = {
	"ember", "cobalt", "amber", "jade", "coral", "indigo", "silver", "scarlet", "atlas",
	"lotus", "cedar", "pine", "aurora", "frost", "orbit", "dune", "maple", "zenith",
}
local profile_nouns = {
	"falcon", "otter", "comet", "harbor", "meadow", "emberfox", "lynx", "kestrel",
	"glacier", "thicket", "river", "moss", "canyon", "beacon", "auroraforge", "wave", "ridge",
}

local right_status_cols = wezterm.GLOBAL and wezterm.GLOBAL.right_status_cols or {}
if wezterm.GLOBAL then
	wezterm.GLOBAL.right_status_cols = right_status_cols
end

local chatgpt_usage = { checked_at = 0, windows = {} }
local chatgpt_usage_cache = (os.getenv("XDG_CACHE_HOME") or ((os.getenv("HOME") or "") .. "/.cache")) .. "/wezterm/codex-usage.json"
local profile_cache = { checked_at = 0 }
local reset_credits = { checked_at = 0 }

-- Reusable status table structure
local status = {}

local function get_window_key(window)
	local ok, window_id = pcall(function()
		return window:window_id()
	end)
	if ok and window_id ~= nil then
		return tostring(window_id)
	end
	return "default"
end

local function text_width(text)
	if wezterm.column_width then
		return wezterm.column_width(text)
	end
	return #text
end

local function status_width(items)
	local width = 0
	for _, item in ipairs(items) do
		if item.Text then
			width = width + text_width(item.Text)
		end
	end
	return width
end

local function get_workhours_display(window)
	local wday = os.date("*t").wday
	if wday == 1 or wday == 7 then
		return nil
	end

	local mux_window = window:mux_window()
	if mux_window == nil then
		return wezterm.nerdfonts.fa_hourglass_start, "-.-", color_workhours_start
	end

	local active_pane = mux_window:active_pane()
	if active_pane == nil then
		return wezterm.nerdfonts.fa_hourglass_start, "-.-", color_workhours_start
	end

	local user_vars = active_pane:get_user_vars() or {}
	local hours_worked = time_utils.calculate_hour_difference(user_vars.first_login, wezterm.strftime("%H:%M:%S"))
	if hours_worked == nil or hours_worked <= 0 or hours_worked >= 10 then
		return wezterm.nerdfonts.fa_hourglass_start, "-.-", color_workhours_start
	end

	local icon = wezterm.nerdfonts.fa_hourglass_start
	local color = color_workhours_start
	if hours_worked > 8 then
		icon = wezterm.nerdfonts.fa_hourglass_o
		color = color_workhours_over
	elseif hours_worked >= 7 then
		icon = wezterm.nerdfonts.fa_hourglass_o
		color = color_workhours_good
	elseif hours_worked >= 5 then
		icon = wezterm.nerdfonts.fa_hourglass_end
		color = color_workhours_end
	elseif hours_worked >= 2 then
		icon = wezterm.nerdfonts.fa_hourglass_half
		color = color_workhours_half
	end

	local hours_text = string.format("%.1f", hours_worked):gsub("%.0$", "")
	return icon, hours_text, color
end

local function usage_color(remaining)
	if remaining >= 75 then
		return color_usage_good
	end
	if remaining >= 50 then
		return color_usage_warn
	end
	if remaining >= 25 then
		return color_usage_caution
	end
	return color_usage_critical
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

local function profile_label(account_id)
	local seed = account_id:gsub("[^0-9a-fA-F]", "")
	if seed == "" then
		seed = "00"
	end
	local adjective = profile_adjectives[(tonumber(seed:sub(1, 2), 16) or 0) % #profile_adjectives + 1]
	local noun = profile_nouns[(tonumber(seed:sub(3, 4), 16) or 0) % #profile_nouns + 1]
	local generated = string.format("%s-%s-%s", adjective, noun, account_id:sub(-4))
	return profile_aliases[generated] or generated
end

local function get_profile()
	if os.time() - profile_cache.checked_at < 1 then
		return profile_cache.label, profile_cache.tokens
	end

	profile_cache.checked_at = os.time()
	profile_cache.label = nil
	profile_cache.tokens = nil
	local auth_file = io.open((os.getenv("HOME") or "") .. "/.codex/auth.json", "r")
	if auth_file == nil then
		return nil, nil
	end

	local content = auth_file:read("*a")
	auth_file:close()
	local ok, auth = pcall(wezterm.json_parse, content)
	local tokens = ok and auth and auth.tokens
	if type(tokens) ~= "table" or type(tokens.account_id) ~= "string" or type(tokens.access_token) ~= "string" then
		return nil, nil
	end

	profile_cache.tokens = tokens
	profile_cache.label = profile_label(tokens.account_id)
	return profile_cache.label, tokens
end

local function get_reset_credits(tokens)
	if tokens == nil or reset_credits.account_id ~= tokens.account_id or os.time() - reset_credits.checked_at >= 8 * 60 * 60 then
		reset_credits.checked_at = os.time()
		reset_credits.account_id = tokens and tokens.account_id or nil
		reset_credits.count = nil
		reset_credits.expires_at = nil
		if tokens then
			local ok, stdout = wezterm.run_child_process({
				"curl", "--silent", "--show-error", "--connect-timeout", "5", "--max-time", "10",
				"--header", "Authorization: Bearer " .. tokens.access_token,
				"--header", "ChatGPT-Account-Id: " .. tokens.account_id,
				"https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
			})
			local parsed_ok, data = false, nil
			if ok then
				parsed_ok, data = pcall(wezterm.json_parse, stdout)
			end
			if type(data) == "table" and tonumber(data.available_count) then
				reset_credits.count = math.max(0, math.floor(tonumber(data.available_count)))
				for _, credit in ipairs(data.credits or {}) do
					if credit.status == "available" and type(credit.expires_at) == "string" and (reset_credits.expires_at == nil or credit.expires_at < reset_credits.expires_at) then
						reset_credits.expires_at = credit.expires_at
					end
				end
			end
		end
	end

	return reset_credits.count, reset_credits.expires_at
end

local function reset_credit_color(expires_at)
	local expires_timestamp = type(expires_at) == "string" and parse_utc_timestamp(expires_at) or nil
	if expires_timestamp == nil then
		return color_gray
	end

	local seconds = expires_timestamp - os.time()
	if seconds <= 24 * 60 * 60 then
		return color_usage_critical
	end
	if seconds <= 7 * 24 * 60 * 60 then
		return color_usage_warn
	end
	return color_gray
end

local function get_chatgpt_usage()
	local now = os.time()
	local cache_file = io.open(chatgpt_usage_cache, "r")
	local content = cache_file and cache_file:read("*a") or ""
	if cache_file then
		cache_file:close()
	end

	local parsed_ok, response = pcall(wezterm.json_parse, content)
	local usage = parsed_ok and response and response[1] and response[1].usage
	if type(usage) == "table" then
		chatgpt_usage.windows = {}
		for _, window in ipairs({ usage.primary or false, usage.secondary or false }) do
			local used_percent = type(window) == "table" and tonumber(window.usedPercent) or nil
			if used_percent then
				local remaining = math.max(0, math.min(100, 100 - math.floor(used_percent)))
				table.insert(chatgpt_usage.windows, {
					color = usage_color(remaining),
					remaining = remaining,
					resets_at = window.resetsAt,
				})
			end
		end
	end

	if now - chatgpt_usage.checked_at >= 600 then
		chatgpt_usage.checked_at = now
		wezterm.background_child_process({
			"sh", "-c",
			string.format(
				"mkdir -p %q && temporary=%q.$$ && codexbar usage --source oauth --provider codex --json >\"$temporary\" && mv \"$temporary\" %q",
				chatgpt_usage_cache:match("^(.+)/[^/]+$"), chatgpt_usage_cache, chatgpt_usage_cache
			),
		})
	end

	return chatgpt_usage.windows
end

local function append_chatgpt_usage(items)
	local windows = get_chatgpt_usage()
	local profile, tokens = get_profile()
	local reset_count, reset_expires_at = get_reset_credits(tokens)
	if profile == nil and #windows == 0 then
		return
	end

	if profile then
		table.insert(items, { Foreground = color_gray })
		table.insert(items, { Text = profile })
		if reset_count ~= nil then
			table.insert(items, { Foreground = reset_credit_color(reset_expires_at) })
			table.insert(items, { Text = " (" .. reset_count .. ") " })
		else
			table.insert(items, { Text = " " })
		end
	end

	for index, window in ipairs(windows) do
		local window_color = (#windows == 1 and window.remaining == 0) and color_gray or window.color
		local filled = math.floor(window.remaining * 9 / 100)
		if window.remaining > 0 and filled == 0 then
			filled = 1
		end
		table.insert(items, { Foreground = window_color })
		table.insert(items, { Text = string.rep("▂", filled) })
		table.insert(items, { Foreground = color_gray })
		table.insert(items, { Text = string.rep("▁", 9 - filled) .. " " })
		table.insert(items, { Foreground = window_color })
		table.insert(items, { Text = window.remaining .. "%" })
		local countdown = format_countdown(window.resets_at)
		if countdown then
			table.insert(items, { Foreground = color_gray })
			table.insert(items, { Text = " " .. countdown })
		end
		if index < #windows then
			table.insert(items, { Foreground = color_gray })
			table.insert(items, { Text = " " })
		end
	end

	table.insert(items, { Text = " " })
	table.insert(items, { Foreground = color_separator })
	table.insert(items, { Text = "▏" })
end

local function update_right_status(window)
	local waiting_count = 0
	local herdr_summary = herdr.get_summary()
	local init_notice = agent_deck.consume_init_notice and agent_deck.consume_init_notice() or nil
	if init_notice then
		window:toast_notification("Agent Deck", init_notice, nil, 2500)
	end

	if agent_deck then
		local mux_window = window:mux_window()
		if mux_window then
			for _, tab in ipairs(mux_window:tabs()) do
				for _, pane in ipairs(tab:panes()) do
					agent_deck.update_pane(pane)
				end
			end
		end

		waiting_count = agent_deck.count_waiting()
	end

	local date = wezterm.strftime("(%Y-%m-%d) %a %b %-d ")
	local time = wezterm.strftime("%H:%M")
	local week_number = os.date("%V")
	local workhours_icon, workhours_text, workhours_color = get_workhours_display(window)
	local herdr_working_icon = agent_deck.get_status_icon("working")
	local herdr_blocked_icon = agent_deck.get_status_icon("waiting")
	local herdr_working_color = { Color = agent_deck.get_status_color("working") }
	local herdr_blocked_color = { Color = agent_deck.get_status_color("waiting") }

	-- Reset and reuse the status table
	status = {
		{ Foreground = color_waiting },
		{ Text = waiting_count > 0 and ("◔ " .. waiting_count .. " ") or "" },
		{ Foreground = color_separator },
		{ Text = waiting_count > 0 and "▏" or "" },
		{ Foreground = herdr_working_color },
		{ Text = herdr_summary.working > 0 and (herdr_working_icon .. " " .. herdr_summary.working .. " ") or "" },
		{ Foreground = herdr_blocked_color },
		{ Text = herdr_summary.blocked > 0 and (herdr_blocked_icon .. " " .. herdr_summary.blocked .. " ") or "" },
		{ Foreground = color_separator },
		{ Text = (herdr_summary.working > 0 or herdr_summary.blocked > 0) and "▏" or "" },
	}

	append_chatgpt_usage(status)

	table.insert(status, { Foreground = color_gray })
	table.insert(status, { Text = date })
	table.insert(status, { Foreground = color_separator })
	table.insert(status, { Text = "▏" })
	table.insert(status, { Foreground = color_gray })
	table.insert(status, { Text = wezterm.nerdfonts.cod_calendar .. " " .. tonumber(week_number) })
	table.insert(status, { Foreground = color_separator })
	table.insert(status, { Text = " ▏" })
	table.insert(status, { Foreground = color_white })
	table.insert(status, { Text = time })
	table.insert(status, { Foreground = color_separator })
	table.insert(status, { Text = "▕" })

	if workhours_icon and workhours_text and workhours_color then
		table.insert(status, { Text = " " })
		table.insert(status, { Foreground = workhours_color })
		table.insert(status, { Text = workhours_icon .. " " .. workhours_text .. " " })
	end

	right_status_cols[get_window_key(window)] = status_width(status)
	window:set_right_status(wezterm.format(status))
end

return function(config)
	if not is_windows then
		wezterm.on("update-right-status", update_right_status)
		wezterm.on("user-var-changed", function(window, _, name)
			if name == "codex_profile_changed" then
				chatgpt_usage.checked_at = 0
				chatgpt_usage.windows = {}
				profile_cache.checked_at = 0
				reset_credits.checked_at = 0
				update_right_status(window)
			end
		end)
	end
end
