package.path = package.path
	.. ";./.config/wezterm/?.lua"
	.. ";./.config/wezterm/?/init.lua"

local registered_events = {}

package.loaded.wezterm = {
	GLOBAL = {},
	mux = {
		get_pane = function()
			return nil
		end,
	},
	on = function(event, callback)
		registered_events[event] = callback
	end,
}

package.loaded.theme = {
	tab_bar = {
		active_fg = "active",
		inactive_fg = "inactive",
	},
}

package.loaded.agent = {
	get_status_icon = function(status)
		return "[" .. status .. "]"
	end,
	get_status_color = function(status)
		return status
	end,
}

package.loaded["agent.herdr"] = {
	get_summary = function()
		return { working = 2, blocked = 1, idle = 3, inactive = 1 }
	end,
}

local function assert_eq(actual, expected, label)
	if actual ~= expected then
		error((label or "assert_eq failed") .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual))
	end
end

require("tabs")({})

local format_tab_title = registered_events["format-tab-title"]
assert_eq(type(format_tab_title), "function", "tab title callback registered")

local title = format_tab_title({
	active_pane = { title = "herdr ~/dotfiles" },
	panes = {},
	tab_index = 1,
	window_id = 1,
	is_active = true,
}, {}, {}, {}, false, 120)

local text = {}
for _, item in ipairs(title) do
	if item.Text then
		table.insert(text, item.Text)
	end
end

local rendered_title = table.concat(text)
assert_eq(rendered_title:find("~/dotfiles", 1, true) ~= nil, true, "Herdr title")
assert_eq(rendered_title:find("[working] 2", 1, true) ~= nil, true, "working status")
assert_eq(rendered_title:find("[waiting] 1", 1, true) ~= nil, true, "blocked status")
assert_eq(rendered_title:find("[idle] 3", 1, true) ~= nil, true, "idle status")
assert_eq(rendered_title:find("[inactive] 1", 1, true) ~= nil, true, "done status")

print("herdr_tab_title_spec: ok")
