package.path = package.path
	.. ";./.config/wezterm/lua/?.lua"
	.. ";./.config/wezterm/lua/?/init.lua"

local registered_events = {}

package.loaded.wezterm = {
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
	on = function(event, callback)
		registered_events[event] = callback
	end,
}

package.loaded["lua.agent"] = {
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
assert_eq(find_text(captured_status, "[end] 6.5 "), true, "workhours indicator rendered")

print("status_workhours_spec: ok")
