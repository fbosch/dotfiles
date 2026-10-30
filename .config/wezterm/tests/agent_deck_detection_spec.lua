package.path = package.path .. ";./.config/wezterm/?.lua" .. ";./.config/wezterm/?/init.lua"

local function assert_eq(actual, expected, label)
	if actual ~= expected then
		error((label or "assert_eq failed") .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual))
	end
end

local plugin = {
	apply_to_config = function() end,
	update_pane = function() end,
	get_agent_state = function()
		return { agent_type = "claude", status = "waiting" }
	end,
	get_status_icon = function()
		return "plugin icon"
	end,
	get_status_color = function()
		return "plugin color"
	end,
}
local current_plugin = plugin
local clock_seconds = 1

package.loaded.wezterm = nil
package.loaded.theme = nil
package.preload.wezterm = function()
	return {
		nerdfonts = {},
		target_triple = "x86_64-unknown-linux-gnu",
		plugin = {
			require = function()
				return current_plugin
			end,
		},
		on = function() end,
		log_warn = function() end,
		time = {
			now = function()
				return {
					format = function()
						return tostring(clock_seconds)
					end,
				}
			end,
		},
	}
end
package.preload.theme = function()
	return {
		semantic = {
			attention = "yellow",
			muted = "gray",
			agent = {
				working = "green",
				idle = "blue",
			},
		},
	}
end

local pane = {
	pane_id = function()
		return 1
	end,
}

local deck = require("agent.deck")
assert_eq(deck.apply({}), plugin, "plugin loads")
local state = deck.update_pane(pane)
assert_eq(state and state.agent_type, "claude", "plugin agent state")
assert_eq(state and state.status, "waiting", "plugin waiting state")
assert_eq(deck.count_waiting(), 1, "waiting agent counted")
assert_eq(deck.get_status_icon("working"), "plugin icon", "plugin icon")
assert_eq(deck.get_status_color("working"), "plugin color", "plugin color")

plugin.update_pane = function()
	error("plugin update failed")
end
clock_seconds = 2
local failed_state = deck.update_pane(pane)
assert_eq(failed_state, nil, "failed plugin update clears stale state")
assert_eq(deck.get(), nil, "plugin failure disables plugin")
assert_eq(deck.count_waiting(), 0, "failed plugin waiting count cleared")
assert_eq(deck.get_status_icon("working"), "●", "fallback icon remains available")
assert_eq(deck.get_status_color("working"), "green", "fallback color remains available")

package.loaded["agent.deck"] = nil
current_plugin = {
	apply_to_config = function()
		error("plugin apply failed")
	end,
}
deck = require("agent.deck")
assert_eq(deck.apply({}), nil, "plugin initialization failure")
assert_eq(deck.consume_init_notice(), "Agent deck failed to initialize", "failure notice")

print("agent_deck_detection_spec: ok")
