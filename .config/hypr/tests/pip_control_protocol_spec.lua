local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/pip_control_protocol_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local pip = require("lib.picture_in_picture")

local function assert_equal(actual, expected, message)
	if actual ~= expected then
		error(string.format("%s: expected %s, got %s", message, tostring(expected), tostring(actual)), 2)
	end
end

describe("picture-in-picture control protocol", function()
	it("round-trips commands with an address", function()
		local line = pip.control.encode("drag-start", "0x55f0")
		assert_equal(line, "drag-start 0x55f0", "encoded line")

		local action, address = pip.control.decode(line)
		assert_equal(action, "drag-start", "action")
		assert_equal(address, "0x55f0", "address")
	end)

	it("encodes bare commands without a trailing separator", function()
		assert_equal(pip.control.encode("ping"), "ping", "bare command")
		assert_equal(select(2, pip.control.decode("resize-end")), nil, "no address decoded")
	end)

	it("carries the move direction as a first-class field", function()
		local line = pip.control.encode("move", "0x55f0", "left")
		assert_equal(line, "move left 0x55f0", "encoded move")

		local action, address, direction = pip.control.decode(line)
		assert_equal(action, "move", "move action")
		assert_equal(address, "0x55f0", "move address")
		assert_equal(direction, "left", "move direction")
	end)

	it("rejects malformed input instead of guessing", function()
		assert_equal(pip.control.decode(nil), nil, "nil line")
		assert_equal(pip.control.decode(""), nil, "empty line")
		local action = pip.control.decode("move")
		assert_equal(action, "move", "move without payload still parses")
		assert_equal(select(3, pip.control.decode("move")), nil, "move without payload has no direction")
	end)
end)

describe("picture-in-picture placement acceptance protocol", function()
	it("round-trips corner and free placements", function()
		local corner = { kind = "corner", corner = "top-left", target_monitor = "DP-1", width = 640, height = 360 }
		local free = { kind = "free", target_monitor = "HDMI-A-1", x = 120, y = 340, width = 800, height = 450 }

		assert.same(corner, assert(pip.acceptance.decode(pip.acceptance.encode(corner))))
		assert.same(free, assert(pip.acceptance.decode(pip.acceptance.encode(free))))
		assert.same(
			{ kind = "corner", corner = "top-left", target_monitor = "DP-1" },
			assert(pip.acceptance.normalize({ kind = "corner", corner = "top-left", target_monitor = "DP-1" }))
		)
	end)

	it("rejects malformed placement records", function()
		local malformed = {
			{},
			{ kind = "corner", corner = "sideways", target_monitor = "DP-1" },
			{ kind = "corner", corner = "top-left", target_monitor = "" },
			{ kind = "free", target_monitor = "DP-1", x = "10", y = 20 },
			{ kind = "free", target_monitor = "DP-1", x = 0 / 0, y = 20 },
			{ kind = "free", target_monitor = "DP-1", x = 10, y = 20, width = 640 },
			{ kind = "corner", corner = "top-left", target_monitor = "DP-1", width = 0, height = 360 },
		}

		assert.is_nil(pip.acceptance.normalize(nil))
		for _, value in ipairs(malformed) do
			assert.is_nil(pip.acceptance.normalize(value))
		end
		assert.is_nil(pip.acceptance.decode("wrong-command {}"))
		assert.is_nil(pip.acceptance.decode(pip.acceptance.action .. " not-json"))
	end)
end)

describe("picture-in-picture identity", function()
	it("matches only the exact class and title", function()
		assert_equal(pip.matches({ class = pip.class, title = pip.title }), true, "exact identity")
		assert_equal(pip.matches({ class = pip.class, title = "Browser" }), false, "different title")
		assert_equal(pip.matches({ class = "other", title = pip.title }), false, "different class")
		assert_equal(pip.matches(nil), false, "missing window")
	end)
end)

describe("picture-in-picture window rules", function()
	it("applies static setup and slide animation to every PiP state", function()
		local rules = {}
		_G.hl = {
			window_rule = function(rule)
				rules[#rules + 1] = rule
			end,
		}

		pip.register_window_rules()
		_G.hl = nil

		local base_rule = rules[1]
		assert.is_true(base_rule.no_initial_focus)
		assert.is_false(base_rule.focus_on_activate)
		assert_equal(base_rule.suppress_event, "maximize", "suppressed event")
		assert_equal(base_rule.size, nil, "size")
		assert_equal(base_rule.max_size, nil, "maximum size")
		assert_equal(base_rule.fullscreen_state, nil, "fullscreen state")
		assert.is_true(base_rule.persistent_size)
		assert_equal(rules[2].animation, "slide bottom", "default animation")
		local corner_animations = {}
		for index = 3, 6 do
			corner_animations[rules[index].match.tag] = rules[index].animation
		end
		assert_equal(corner_animations["pip-top-left"], "slide top", "top-left animation")
		assert_equal(corner_animations["pip-top-right"], "slide top", "top-right animation")
		assert_equal(corner_animations["pip-bottom-left"], "slide bottom", "bottom-left animation")
		assert_equal(corner_animations["pip-bottom-right"], "slide bottom", "bottom-right animation")
	end)
end)
