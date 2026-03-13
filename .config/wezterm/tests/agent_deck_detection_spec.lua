package.path = package.path
	.. ";./.config/wezterm/lua/?.lua"
	.. ";./.config/wezterm/lua/?/init.lua"

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
	text = "Type your own answer\n",
	has_opencode_process = false,
})
assert_eq(overlay_rejected, nil, "hinted overlay requires waiting pattern")

print("agent_deck_detection_spec: ok")
