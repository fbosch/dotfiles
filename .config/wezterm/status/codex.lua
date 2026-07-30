local wezterm = require("wezterm")
local palette = require("theme")

package.path = wezterm.config_dir .. "/../fbb/lua/?.lua;" .. package.path
local ocma = require("fbb.ocma")

local codex_status = { checked_at = 0, accounts = {} }
local home_dir = os.getenv("HOME") or ""
local status_cache = (os.getenv("XDG_CACHE_HOME") or (home_dir .. "/.cache")) .. "/wezterm/ocma-status.json"
local ocma_command = home_dir .. "/.config/fbb/bin/ocma"
local command_path = table.concat({
	-- Home Manager exposes user packages here on macOS and NixOS.
	"/etc/profiles/per-user/" .. (os.getenv("USER") or "") .. "/bin",
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

local function reset_credit_color(urgency)
	if urgency == "urgent" then
		return palette.semantic.critical
	end
	if urgency == "soon" then
		return palette.semantic.attention
	end
	return palette.semantic.muted
end

local superscript_digits = {
	["0"] = "⁰",
	["1"] = "¹",
	["2"] = "²",
	["3"] = "³",
	["4"] = "⁴",
	["5"] = "⁵",
	["6"] = "⁶",
	["7"] = "⁷",
	["8"] = "⁸",
	["9"] = "⁹",
}
local superscript_units = {
	d = "ᵈ",
	h = "ʰ",
	m = "ᵐ",
	s = "ˢ",
}

local function superscript_number(value)
	return tostring(math.floor(value)):gsub("%d", superscript_digits)
end

local function superscript_duration(value)
	local superscript = value:gsub("%d", superscript_digits)
	return superscript:gsub("[dhms]", superscript_units)
end

local function reset_in(seconds)
	if type(seconds) ~= "number" then
		return nil
	end
	if seconds <= 0 then
		return "now"
	end
	if seconds < 60 then
		return string.format("%ds", math.ceil(seconds))
	end
	if seconds < 3600 then
		return string.format("%dm", math.ceil(seconds / 60))
	end
	if seconds < 86400 then
		return string.format("%dh", math.ceil(seconds / 3600))
	end
	return string.format("%dd", math.ceil(seconds / 86400))
end

local function get_accounts()
	local accounts = ocma.read_accounts(status_cache, wezterm.json_parse, reset_in)
	if accounts then
		codex_status.accounts = accounts
	end

	if os.time() - codex_status.checked_at >= 10 * 60 then
		codex_status.checked_at = os.time()
		wezterm.background_child_process({
			"/bin/sh",
			"-c",
			string.format(
				'PATH=%q; export PATH; mkdir -p %q && temporary=%q.$$ && %q list --format json >"$temporary" && mv "$temporary" %q',
				command_path,
				status_cache:match("^(.+)/[^/]+$"),
				status_cache,
				ocma_command,
				status_cache
			),
		})
	end

	return codex_status.accounts
end

local function append_usage(items, windows)
	local rendered = 0
	for _, window in ipairs(type(windows) == "table" and windows or {}) do
		local remaining = type(window) == "table" and tonumber(window.remaining) or nil
		if remaining ~= nil then
			table.insert(items, { Foreground = { Color = palette.semantic.muted } })
			if rendered == 0 then
				table.insert(items, { Text = " " })
			else
				table.insert(items, { Text = "/" })
			end
			table.insert(items, { Foreground = { Color = usage_color(remaining) } })
			table.insert(items, { Text = string.format("%d%%", math.floor(remaining)) })
			if type(window.resetsIn) == "string" then
				table.insert(items, { Foreground = { Color = palette.semantic.muted } })
				table.insert(items, { Text = "⁽" .. superscript_duration(window.resetsIn) .. "⁾" })
			end
			rendered = rendered + 1
		end
	end
end

local function append(items)
	local accounts = get_accounts()
	if #accounts == 0 then
		return
	end

	for index, account in ipairs(accounts) do
		if index > 1 then
			table.insert(items, { Foreground = { Color = palette.semantic.separator } })
			table.insert(items, { Text = " ▏ " })
		end
		local profile_color = account.active and palette.ansi.magenta or palette.semantic.muted
		table.insert(items, { Foreground = { Color = profile_color } })
		table.insert(items, { Text = account.profileLabel })
		if account.active then
			table.insert(items, { Foreground = { Color = palette.ansi.magenta } })
			table.insert(items, { Text = "*" })
		end
		if tonumber(account.availableCount) and tonumber(account.availableCount) > 0 then
			table.insert(items, { Foreground = { Color = reset_credit_color(account.urgency) } })
			table.insert(items, { Text = "⁽" .. superscript_number(tonumber(account.availableCount)) .. "⁾" })
		end
		append_usage(items, account.usage)
	end

	table.insert(items, { Text = " " })
	table.insert(items, { Foreground = { Color = palette.semantic.separator } })
	table.insert(items, { Text = "▏" })
end

local function handle_user_var(name)
	if name == "codex_profile_changed" then
		codex_status.checked_at = 0
		return true
	end
	if name == "codex_reset_refreshed" then
		codex_status.checked_at = 0
		return true
	end
	return false
end

return {
	append = append,
	handle_user_var = handle_user_var,
}
