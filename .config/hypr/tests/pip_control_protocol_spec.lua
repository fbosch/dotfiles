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
		assert_equal(pip.matches({ class = pip.class, title = pip.title }), true, "Zen identity")
		assert_equal(
			pip.matches({ class = "app.zen_browser.zen-pip", title = pip.title }),
			true,
			"relabeled Zen identity"
		)
		assert_equal(
			pip.matches({ class = "one.ablaze.floorp-pip", title = pip.title }),
			true,
			"relabeled Floorp identity"
		)
		assert_equal(
			pip.matches({ class = "helium-pip", title = "Picture in picture" }),
			true,
			"relabeled Helium identity"
		)
		assert_equal(pip.matches({ class = pip.class, title = "Browser" }), false, "different title")
		assert_equal(pip.matches({ class = "other", title = pip.title }), false, "different class")
		assert_equal(pip.matches(nil), false, "missing window")
	end)
end)

describe("picture-in-picture window rules", function()
	it("applies static setup and slide animation to all supported PiP identities", function()
		local rules = {}
		_G.hl = {
			window_rule = function(rule)
				rules[#rules + 1] = rule
			end,
		}

		pip.register_window_rules()
		_G.hl = nil

		local setup_rules = {}
		local default_animation_rules = {}
		local placement_rules = {}
		local corner_animations = {}
		for _, rule in ipairs(rules) do
			if rule.float == true then
				setup_rules[#setup_rules + 1] = rule
			elseif rule.animation == pip.default_animation then
				default_animation_rules[#default_animation_rules + 1] = rule
			elseif rule.move == pip.normal_move then
				placement_rules[#placement_rules + 1] = rule
			elseif rule.match.tag then
				corner_animations[rule.match.tag] = rule.animation
			end
		end

		local function find_class_rule(candidates, class_pattern)
			for _, rule in ipairs(candidates) do
				if rule.match.class == class_pattern then
					return rule
				end
			end
			error("missing static PiP rule for " .. class_pattern)
		end

		local relabeled_setup = find_class_rule(setup_rules, pip.pip_class_pattern)
		assert_equal(relabeled_setup.tag, "+pip", "semantic PiP tag")
		assert_equal(relabeled_setup.match.title, nil, "current title")
		assert_equal(relabeled_setup.match.initial_title, nil, "relabeled initial title")
		assert.is_true(relabeled_setup.no_initial_focus)
		assert.is_false(relabeled_setup.focus_on_activate)
		assert_equal(relabeled_setup.suppress_event, "maximize", "suppressed event")
		assert_equal(relabeled_setup.size, nil, "initial size")
		assert_equal(relabeled_setup.max_size, nil, "maximum size")
		assert_equal(relabeled_setup.fullscreen_state, nil, "fullscreen state")
		assert_equal(relabeled_setup.persistent_size, nil, "persistent size")

		local zen_setup = find_class_rule(setup_rules, "^app[.]zen_browser[.]zen$")
		assert_equal(zen_setup.match.initial_title, "^Picture-in-Picture$", "Zen PiP initial title")
		assert_equal(zen_setup.tag, "+pip", "Zen semantic PiP tag")
		assert_equal(zen_setup.size, nil, "Zen initial size")
		assert_equal(zen_setup.max_size, nil, "Zen maximum size")

		assert_equal(#default_animation_rules, 2, "default animation identities")
		assert.is_not_nil(find_class_rule(default_animation_rules, pip.pip_class_pattern))
		assert.is_not_nil(find_class_rule(default_animation_rules, "^app[.]zen_browser[.]zen$"))

		assert_equal(#placement_rules, 2, "placement identities")
		assert.is_not_nil(find_class_rule(placement_rules, pip.pip_class_pattern))
		assert.is_not_nil(find_class_rule(placement_rules, "^app[.]zen_browser[.]zen$"))

		assert_equal(corner_animations["pip-top-left"], "slide top", "top-left animation")
		assert_equal(corner_animations["pip-top-right"], "slide top", "top-right animation")
		assert_equal(corner_animations["pip-bottom-left"], "slide bottom", "bottom-left animation")
		assert_equal(corner_animations["pip-bottom-right"], "slide bottom", "bottom-right animation")
	end)
end)
