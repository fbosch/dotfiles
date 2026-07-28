package.path = package.path
	.. ";./.config/wezterm/?.lua"
	.. ";./.config/wezterm/?/init.lua"

local registered_events = {}
local original_io_open = io.open
local mock_used_percent = 57
local mock_credit_count = 2
local usage_refreshes = 0

io.open = function(path, mode)
	if mode == "r" and path:match("codex%-usage%.json$") then
		return {
			read = function()
				return "chatgpt-usage"
			end,
			close = function() end,
		}
	end
	return original_io_open(path, mode)
end

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

		if content == "chatgpt-usage" then
			return {
				{
					usage = {
						secondary = { usedPercent = mock_used_percent },
					},
				},
			}
		end

		local available_count = content:match('"availableCount":(%d+)')
		if available_count then
			return {
				accountId = "f6b80000-0000-0000-0000-00000000efd2",
				availableCount = tonumber(available_count),
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
						yellow = "#B77E64",
					},
				},
			},
		}
	end,
	on = function(event, callback)
		registered_events[event] = callback
	end,
	run_child_process = function(argv)
		if argv[1] == "/bin/sh" and argv[3]:match("reset_helper") then
			return true, string.format('{"accountId":"f6b80000-0000-0000-0000-00000000efd2","availableCount":%d}', mock_credit_count), ""
		end

		if argv[1] == "codexbar" then
			return true, "chatgpt-usage", ""
		end

		return true, "herdr-agents", ""
	end,
	background_child_process = function()
		usage_refreshes = usage_refreshes + 1
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

configure_status({})

local update_status = registered_events["update-right-status"]
assert_eq(type(update_status), "function", "status callback registered")
local user_var_changed = registered_events["user-var-changed"]
assert_eq(type(user_var_changed), "function", "user variable callback registered")

local captured_status
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

local window = {
	mux_window = function()
		return {
			tabs = function()
				return {}
			end,
			active_pane = function()
				return {
					get_user_vars = function()
						return { first_login = "09:00:00" }
					end,
				}
			end,
		}
	end,
	set_right_status = function(_, value)
		captured_status = value
	end,
	toast_notification = function() end,
}

update_status(window)
os.date = original_os_date

assert_eq(type(captured_status), "table", "status payload type")
	assert_eq(find_text(captured_status, "[working] 2 "), true, "Herdr working count rendered")
	assert_eq(find_text(captured_status, "[end] 6.5 "), true, "workhours indicator rendered")
	assert_eq(find_text(captured_status, "work"), true, "Codex profile alias rendered")
	assert_eq(find_text(captured_status, " (2) "), true, "Codex reset credits rendered")
	assert_eq(find_text(captured_status, "▂▂▂"), true, "ChatGPT allowance uses stepped blocks")
	assert_eq(find_text(captured_status, "43%"), true, "ChatGPT remaining allowance rendered")

for _, case in ipairs({
	{ used = 98, block = "▂" },
	{ used = 89, block = "▂" },
	{ used = 77, block = "▂▂" },
	{ used = 0, block = "▂▂▂▂▂▂▂▂▂" },
}) do
	mock_used_percent = case.used
	captured_status = nil
	update_status(window)
	assert_eq(find_text(captured_status, case.block), true, "usage bar renders stepped blocks")
end

captured_status = nil
user_var_changed(window, nil, "codex_profile_changed")
assert_eq(type(captured_status), "table", "profile change rerenders status")

mock_credit_count = 1
local usage_refreshes_before_reset = usage_refreshes
captured_status = nil
user_var_changed(window, nil, "codex_reset_refreshed")
assert_eq(find_text(captured_status, " (1) "), true, "reset redemption refreshes credit count")
assert_eq(usage_refreshes, usage_refreshes_before_reset + 1, "reset redemption refreshes usage")

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

print("status_workhours_spec: ok")
io.open = original_io_open
