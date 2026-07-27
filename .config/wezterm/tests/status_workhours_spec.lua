package.path = package.path
	.. ";./.config/wezterm/?.lua"
	.. ";./.config/wezterm/?/init.lua"

local registered_events = {}
local original_io_open = io.open
local mock_used_percent = 57

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

		if content:match('"availableCount":2') then
			return {
				accountId = "f6b80000-0000-0000-0000-00000000efd2",
				availableCount = 2,
			}
		end

		return {
			zenwritten = {
				dark = {
					background = "#191919",
					foreground = "#BBBBBB",
					semantic = {
						muted = "#636363",
					},
					ansi = {},
				},
			},
		}
	end,
	on = function(event, callback)
		registered_events[event] = callback
	end,
	run_child_process = function(argv)
		if argv[1] == "/bin/sh" and argv[3]:match("reset_helper") then
			return true, [[{"accountId":"f6b80000-0000-0000-0000-00000000efd2","availableCount":2}]], ""
		end

		if argv[1] == "codexbar" then
			return true, "chatgpt-usage", ""
		end

		return true, "herdr-agents", ""
	end,
	background_child_process = function() end,
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
	assert_eq(find_text(captured_status, "███▊"), true, "ChatGPT allowance uses fractional blocks")
	assert_eq(find_text(captured_status, "43%"), true, "ChatGPT remaining allowance rendered")

for _, case in ipairs({
	{ used = 98, block = "▏" },
	{ used = 97, block = "▎" },
	{ used = 95, block = "▍" },
	{ used = 94, block = "▌" },
	{ used = 93, block = "▋" },
	{ used = 91, block = "▊" },
	{ used = 90, block = "▉" },
	{ used = 0, block = "█████████" },
}) do
	mock_used_percent = case.used
	captured_status = nil
	update_status(window)
	assert_eq(find_text(captured_status, case.block), true, "usage bar renders " .. case.block)
end

captured_status = nil
user_var_changed(window, nil, "codex_profile_changed")
assert_eq(type(captured_status), "table", "profile change rerenders status")

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
