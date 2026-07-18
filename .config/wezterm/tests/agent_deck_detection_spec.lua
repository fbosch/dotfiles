package.path = package.path
	.. ";./.config/wezterm/?.lua"
	.. ";./.config/wezterm/?/init.lua"

local detection = require("agent.detection")

local function assert_eq(actual, expected, label)
	if actual ~= expected then
		error((label or "assert_eq failed") .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual))
	end
end

local status_fixtures = {
	{
		name = "waiting wins over working",
		text = [[
Thinking...
Type your own answer
Esc interrupt
]],
		expected = "waiting",
	},
	{
		name = "working detected",
		text = [[
Planning update
In Progress: searching the codebase
]],
		expected = "working",
	},
	{
		name = "idle prompt",
		text = [[
Done.
> 
]],
		expected = "idle",
	},
	{
		name = "no status",
		text = [[
plain shell output
line two
]],
		expected = nil,
	},
}

for _, fixture in ipairs(status_fixtures) do
	local actual = detection.detect_status_from_text(fixture.text)
	assert_eq(actual, fixture.expected, fixture.name)
end

local overlay_confirmed = detection.detect_overlay_state_from_text({
	text = "Esc interrupt\n",
	has_opencode_process = true,
})
assert_eq(overlay_confirmed and overlay_confirmed.status, "working", "confirmed overlay status")
assert_eq(overlay_confirmed and overlay_confirmed.confidence, "confirmed", "confirmed overlay confidence")

local overlay_hinted = detection.detect_overlay_state_from_text({
	text = "Type your own answer\nAllow once\n",
	has_opencode_process = false,
})
assert_eq(overlay_hinted and overlay_hinted.status, "waiting", "hinted overlay status")
assert_eq(overlay_hinted and overlay_hinted.confidence, "hinted", "hinted overlay confidence")

local overlay_rejected = detection.detect_overlay_state_from_text({
	text = "OpenCode screen\n",
	has_opencode_process = false,
	screen_markers = { "OpenCode screen" },
	waiting_patterns = { "Allow once" },
})
assert_eq(overlay_rejected, nil, "hinted overlay requires waiting pattern")

local failing_plugin = {
	apply_to_config = function() end,
	update_pane = function()
		error("plugin update failed")
	end,
}

package.loaded.wezterm = nil
package.loaded.theme = nil
package.loaded["agent.deck"] = nil
package.preload.wezterm = function()
	return {
		nerdfonts = {},
		target_triple = "x86_64-unknown-linux-gnu",
		plugin = {
			require = function()
				return failing_plugin
			end,
		},
		on = function() end,
		log_warn = function() end,
		time = {
			now = function()
				return { format = function() return "1" end }
			end,
		},
	}
end
package.preload.theme = function()
	return {
		agent = {
			working = "green",
			waiting = "yellow",
			idle = "blue",
			inactive = "gray",
		},
	}
end

local deck = require("agent.deck")
deck.apply({})
local pane = {
	pane_id = function() return 1 end,
	get_foreground_process_info = function()
		return { name = "opencode" }
	end,
	get_lines_as_text = function()
		return "Esc interrupt\n"
	end,
}
local fallback_state = deck.update_pane(pane)
assert_eq(fallback_state and fallback_state.status, "working", "plugin failure uses overlay fallback")
assert_eq(deck.get(), nil, "plugin failure disables plugin")
assert_eq(deck.get_status_icon("working"), "●", "plugin failure uses fallback icon")
assert_eq(deck.get_status_color("working"), "green", "plugin failure uses fallback color")

print("agent_deck_detection_spec: ok")
