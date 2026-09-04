package.path = package.path .. ";./.config/wezterm/?.lua" .. ";./.config/wezterm/?/init.lua"

local registered_events = {}
local mock_used_percent = 57
local mock_credit_count = 2
local mock_usage_failure = false
local mock_profile_alias = "ct"

package.loaded.wezterm = {
	config_dir = "." .. package.config:sub(1, 1) .. ".config" .. package.config:sub(1, 1) .. "wezterm",
	strftime = function(format)
		if format == "(%Y-%m-%d) %a %b %-d " then
			return "(2026-03-17) Tue Mar 17 "
		end

		if format == "%H:%M" then
			return "15:30"
		end

		if format == "%H:%M:%S" then
			return "15:30:00"
		end

		error("unexpected strftime format: " .. tostring(format))
	end,
	nerdfonts = {
		cod_calendar = "[calendar]",
		fa_hourglass_start = "[start]",
		fa_hourglass_half = "[half]",
		fa_hourglass_end = "[end]",
		fa_hourglass_o = "[full]",
	},
	format = function(items)
		return items
	end,
	shell_join_args = function(args)
		return table.concat(args, " ")
	end,
	json_parse = function(content)
		if content == "herdr-agents" then
			return {
				result = {
					agents = {
						{ agent_status = "working" },
						{ agent_status = "working" },
						{ agent_status = "idle" },
					},
				},
			}
		end

		if content == "pi-auth-profile-usage" then
			return {
				schema = "fbb.pi-auth-profiles-usage/v1",
				profiles = {
					{
						profileLabel = mock_profile_alias,
						active = true,
						availableCount = mock_credit_count,
						urgency = "urgent",
						usage = {
							{ remaining = 100 - math.floor(mock_used_percent), resetsIn = "3h" },
						},
					},
					{
						profileLabel = "kk",
						active = false,
						availableCount = 1,
						urgency = "later",
						usage = {
							{ remaining = 71, resetsIn = "2h" },
							{ remaining = 94, resetsIn = "5d" },
						},
					},
				},
			}
		end

		return {
			zenwritten = {
				dark = {
					background = "#191919",
					foreground = "#BBBBBB",
					semantic = {
						muted = "#636363",
						active_foreground = "#b7b7b7",
						separator = "#515151",
						tab_active_background = "#262626",
						tab_inactive_background = "#191918",
						subtle = "#999999",
						attention = "#c49f6f",
						critical = "#d79999",
						agent = {
							working = "#8f9a72",
							idle = "#7f9b99",
						},
					},
					ansi = {
						green = "#819B69",
						magenta = "#B279A7",
						yellow = "#B77E64",
						brightRed = "#E8838F",
					},
				},
			},
		}
	end,
	on = function(event, callback)
		registered_events[event] = callback
	end,
	run_child_process = function(argv)
		if argv[1] == "/bin/sh" then
			if not argv[3]:find("--agent-dir", 1, true) then
				error("Pi usage command must pass the canonical agent directory")
			end
			if mock_usage_failure then
				return false, "", "simulated usage failure"
			end
			return true, "pi-auth-profile-usage", ""
		end
		return true, "herdr-agents", ""
	end,
}

package.loaded["agent"] = {
	get_status_icon = function(status)
		return "[" .. status .. "]"
	end,
	get_status_color = function(status)
		return "#ffffff"
	end,
	consume_init_notice = function()
		return nil
	end,
	update_pane = function() end,
	count_waiting = function()
		return 0
	end,
}

local configure_status = require("status")

local function assert_eq(actual, expected, label)
	if actual ~= expected then
		error((label or "assert_eq failed") .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual))
	end
end

local function find_text(items, text)
	for _, item in ipairs(items) do
		if item.Text == text then
			return true
		end
	end

	return false
end

local function color_before_text(items, text)
	for index, item in ipairs(items) do
		if item.Text == text then
			return items[index - 1].Foreground.Color
		end
	end
end

configure_status({})

local update_status = registered_events["update-right-status"]
assert_eq(type(update_status), "function", "status callback registered")
local user_var_changed = registered_events["user-var-changed"]
assert_eq(type(user_var_changed), "function", "user variable callback registered")

local captured_status
local set_right_status_calls = 0
local original_os_date = os.date

os.date = function(format)
	if format == "%V" then
		return "12"
	end

	if format == "*t" then
		return { wday = 3 }
	end

	return original_os_date(format)
end

local active_pane = {
	get_current_working_dir = function()
		return { scheme = "file", file_path = "/Users/fbb/dotfiles" }
	end,
	get_user_vars = function()
		return { first_login = "09:00:00" }
	end,
}

local window = {
	mux_window = function()
		return {
			tabs = function()
				return {}
			end,
			active_pane = function()
				return active_pane
			end,
		}
	end,
	set_right_status = function(_, value)
		set_right_status_calls = set_right_status_calls + 1
		captured_status = value
	end,
	toast_notification = function() end,
}

update_status(window)
os.date = original_os_date

assert_eq(set_right_status_calls, 1, "status update calls set_right_status once")
assert_eq(type(captured_status), "table", "status payload type")
assert_eq(find_text(captured_status, "[working] 2 "), false, "Herdr working count omitted")
assert_eq(find_text(captured_status, "[end] 6.5 "), true, "workhours indicator rendered")
assert_eq(find_text(captured_status, "ct"), true, "active Codex profile alias rendered")
assert_eq(find_text(captured_status, "*"), true, "active Codex profile indicator rendered")
assert_eq(find_text(captured_status, "kk"), true, "inactive Codex profile alias rendered")
assert_eq(find_text(captured_status, "²"), true, "Codex reset credits rendered")
assert_eq(find_text(captured_status, "43%"), true, "ChatGPT remaining allowance rendered")
assert_eq(find_text(captured_status, "³ʰ"), true, "ChatGPT usage reset countdown rendered")
assert_eq(find_text(captured_status, " · "), true, "ChatGPT usage windows separated")
assert_eq(color_before_text(captured_status, "³ʰ"), "#636363", "usage reset countdown is muted")
assert_eq(color_before_text(captured_status, "²"), "#E8838F", "imminently expiring reset credits are prominent")

for _, case in ipairs({
	{ used = 98, remaining = "2" },
	{ used = 89, remaining = "11" },
	{ used = 77, remaining = "23" },
	{ used = 100, remaining = "0" },
	{ used = 0, remaining = "100" },
}) do
	mock_used_percent = case.used
	captured_status = nil
	user_var_changed(window, active_pane, "pi_profile_changed")
	assert_eq(find_text(captured_status, case.remaining .. "%"), true, "usage percentage renders")
end

captured_status = nil
user_var_changed(window, active_pane, "pi_profile_changed")
assert_eq(type(captured_status), "table", "profile change rerenders status")

mock_credit_count = 1
captured_status = nil
user_var_changed(window, active_pane, "pi_usage_changed")
assert_eq(find_text(captured_status, "¹"), true, "usage refresh updates credit count")

mock_credit_count = 0
captured_status = nil
update_status(window)
assert_eq(find_text(captured_status, "⁰"), false, "zero reset credits omitted")

mock_profile_alias = "renamed-profile"
captured_status = nil
user_var_changed(window, active_pane, "pi_profile_changed")
assert_eq(find_text(captured_status, "renamed-profile"), true, "profile refresh renders Pi profile")

mock_usage_failure = true
captured_status = nil
user_var_changed(window, active_pane, "pi_profile_changed")
assert_eq(type(captured_status), "table", "status handles Pi usage failure")
assert_eq(find_text(captured_status, "renamed-profile"), true, "status retains cached Pi profiles on failure")

captured_status = nil
update_status({
	mux_window = function()
		return nil
	end,
	set_right_status = function(_, value)
		captured_status = value
	end,
	toast_notification = function() end,
})

assert_eq(type(captured_status), "table", "status handles missing mux window")

print("right_status_spec: ok")
io.open = original_io_open
