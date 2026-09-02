local wezterm = require("wezterm")
local palette = require("theme")

package.path = wezterm.config_dir .. "/../fbb/lua/?.lua;" .. package.path
local pi_auth_profiles = require("fbb.pi_auth_profiles")

local unpack_args = table.unpack or unpack
local refresh_interval_seconds = 10
local profile_status = { checked_at = 0, cwd = nil, accounts = {} }
local command_search_path = table.concat({
	-- Home Manager exposes user packages here on macOS and NixOS.
	"/etc/profiles/per-user/" .. (os.getenv("USER") or "") .. "/bin",
	"/opt/homebrew/bin",
	"/usr/local/bin",
	"/run/current-system/sw/bin",
	"$PATH",
}, ":")

local function run_command(command, args)
	local command_line = wezterm.shell_join_args({ command, unpack_args(args) })
	return pcall(wezterm.run_child_process, {
		"/bin/sh",
		"-c",
		string.format("PATH=%q; export PATH; %s", command_search_path, command_line),
	})
end

local function pane_cwd(pane)
	if pane == nil then
		return nil
	end

	local cwd_ok, cwd = pcall(function()
		return pane:get_current_working_dir()
	end)
	if not cwd_ok or cwd == nil then
		return nil
	end

	local scheme_ok, scheme = pcall(function()
		return cwd.scheme
	end)
	if scheme_ok and scheme ~= nil and scheme ~= "file" then
		return nil
	end

	local path_ok, file_path = pcall(function()
		return cwd.file_path
	end)
	if path_ok and type(file_path) == "string" and file_path ~= "" then
		return file_path
	end
	if type(cwd) == "string" then
		return cwd:match("^file://[^/]*(/.*)$")
	end
	return nil
end

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
		return palette.ansi.brightRed
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

local function get_accounts(cwd)
	if profile_status.cwd == cwd and os.time() - profile_status.checked_at < refresh_interval_seconds then
		return profile_status.accounts
	end

	profile_status.checked_at = os.time()
	profile_status.cwd = cwd
	local accounts = pi_auth_profiles.list(run_command, wezterm.json_parse, cwd)
	if accounts then
		profile_status.accounts = accounts
	end

	return profile_status.accounts
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
				table.insert(items, { Text = " · " })
			end
			table.insert(items, { Foreground = { Color = usage_color(remaining) } })
			table.insert(items, { Text = string.format("%d%%", math.floor(remaining)) })
			if type(window.resetsIn) == "string" then
				table.insert(items, { Foreground = { Color = palette.semantic.muted } })
				table.insert(items, { Text = superscript_duration(window.resetsIn) })
			end
			rendered = rendered + 1
		end
	end
end

local function append(items, pane)
	local accounts = get_accounts(pane_cwd(pane))
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
			table.insert(items, { Text = superscript_number(tonumber(account.availableCount)) })
		end
		append_usage(items, account.usage)
	end

	table.insert(items, { Text = " " })
	table.insert(items, { Foreground = { Color = palette.semantic.separator } })
	table.insert(items, { Text = "▏" })
end

local function handle_user_var(name)
	if name == "pi_profile_changed" then
		profile_status.checked_at = 0
		return true
	end
	return false
end

return {
	append = append,
	handle_user_var = handle_user_var,
}
