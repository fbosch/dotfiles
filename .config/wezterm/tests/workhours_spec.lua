package.path = package.path .. ";./.config/wezterm/?.lua"

local now = 1000
local today = "26-10-29"
local clock = "12:29:50"
local weekday = 5
local files = { ["/cache/first_login/26-10-29"] = "08:54:10" }
local reads, detections = 0, 0
local original_date, original_time, original_getenv, original_open = os.date, os.time, os.getenv, io.open
os.date = function(format)
	if format == "*t" then
		return { wday = weekday }
	end
	assert(format == "%y-%m-%d", "unexpected date format")
	return today
end
os.time = function()
	return now
end
os.getenv = function(name)
	return ({ XDG_CACHE_HOME = "/cache", HOME = "/home/test", USER = "test" })[name]
end
io.open = function(path)
	reads = reads + 1
	local value = files[path]
	if value == nil then
		return nil
	end
	return {
		read = function()
			return value
		end,
		close = function() end,
	}
end
package.loaded.wezterm = {
	target_triple = "aarch64-apple-darwin",
	strftime = function()
		return clock
	end,
	background_child_process = function(argv)
		assert(argv[1] == "/bin/sh")
		assert(argv[3]:find("first_login_of_the_day --silent", 1, true))
		detections = detections + 1
	end,
	nerdfonts = {
		fa_hourglass_start = "start",
		fa_hourglass_half = "half",
		fa_hourglass_end = "end",
		fa_hourglass_o = "full",
	},
}
package.loaded.theme = { semantic = { subtle = "", attention = "", critical = "" }, ansi = { yellow = "", green = "" } }
local workhours = require("status.workhours")
local stale_window = {
	mux_window = function()
		return {
			active_pane = function()
				return {
					get_user_vars = function()
						return { first_login = "07:24:38" }
					end,
				}
			end,
		}
	end,
}
local function expect(expected, label)
	local _, actual = workhours.get_display(stale_window)
	assert(actual == expected, label .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual))
end
expect("3.6", "today's cache replaces Monday's surviving pane value")
files["/cache/first_login/26-10-29"] = "08:50:00"
now = now + 9
expect("3.6", "cache reads are throttled")
assert(reads == 1)
now = now + 1
expect("3.7", "manual correction appears after ten seconds")
assert(detections == 0)

today = "26-10-30"
expect("-.-", "date rollover invalidates yesterday immediately")
assert(detections == 1)
now = now + 10
expect("-.-", "missing cache never reuses yesterday")
assert(detections == 1, "detection retries are throttled")
files["/cache/first_login/26-10-30"] = "09:00:00"
now = now + 10
expect("3.5", "background detection result is picked up")
files["/cache/first_login/26-10-30"] = "25:00:00"
now = now + 60
expect("-.-", "invalid cache is rejected")
assert(detections == 2)
files["/cache/first_login/26-10-30"] = "09:00:00"
now = now + 10
expect("3.5", "valid cache recovers")
weekday = 7
expect(nil, "weekend remains hidden")

os.date, os.time, os.getenv, io.open = original_date, original_time, original_getenv, original_open
print("workhours_spec: ok")
