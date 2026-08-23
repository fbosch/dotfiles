local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/rate_limit_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local rate_limit = require("lib.rate_limit")

local function assert_equal(actual, expected, message)
	if actual ~= expected then
		error(string.format("%s: expected %s, got %s", message, tostring(expected), tostring(actual)), 2)
	end
end

local function throttle(interval)
	local clock = 0
	local messages = {}
	local emit, reset = rate_limit.new(
		function(message)
			messages[#messages + 1] = message
		end,
		interval,
		function()
			return clock
		end
	)

	return {
		emit = emit,
		reset = reset,
		messages = messages,
		set_clock = function(value)
			clock = value
		end,
	}
end

it("emits on first call and suppresses repeats within the interval", function()
	local t = throttle(30)

	t.emit("key", "first")
	assert_equal(#t.messages, 1, "first emit")

	t.set_clock(10)
	t.emit("key", "second")
	assert_equal(#t.messages, 1, "suppressed emit")
end)

it("emits again after the interval elapses", function()
	local t = throttle(30)

	t.emit("key", "first")
	t.set_clock(31)
	t.emit("key", "second")
	assert_equal(#t.messages, 2, "emit after interval")
end)

it("tracks keys independently", function()
	local t = throttle(30)

	t.emit("a", "a1")
	t.emit("b", "b1")
	assert_equal(#t.messages, 2, "two keys emit")

	t.set_clock(10)
	t.emit("a", "a2")
	assert_equal(#t.messages, 2, "a suppressed while b already emitted")
end)

it("reset clears the throttle for a key", function()
	local t = throttle(30)

	t.emit("key", "first")
	t.set_clock(10)
	t.emit("key", "second")
	assert_equal(#t.messages, 1, "suppressed before reset")

	t.reset("key")
	t.emit("key", "third")
	assert_equal(#t.messages, 2, "emits after reset")
end)
