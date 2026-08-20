local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/mouse_release_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local registrations
local bind
local mouse_release

before_each(function()
	registrations = {}
	bind = {
		consume = function()
			return {}
		end,
		register = function(keys, action, options)
			registrations[#registrations + 1] = { keys = keys, action = action, options = options }
		end,
	}
	package.loaded["lib.mouse_release"] = nil
	mouse_release = require("lib.mouse_release").new(bind)
end)

it("requests and handles the triggering mouse release", function()
	local finished = 0
	mouse_release.bind("SUPER + mouse:273", function()
		return function()
			finished = finished + 1
		end
	end)

	local pressed = registrations[1].action()
	local released = registrations[1].action()

	assert.are.equal(1, finished)
	assert.is_true(pressed.request_release)
	assert.are.same({}, released)
	assert.are.same({ mouse = true }, registrations[1].options)
end)

it("does not request a release when the interaction did not start", function()
	mouse_release.bind("ALT + mouse:274", function() end)

	local result = registrations[1].action()

	assert.is_nil(result.request_release)
end)

it("finishes the interaction when Hyprland invokes the release follow-up", function()
	local started = 0
	local finished = 0
	mouse_release.bind("SUPER + mouse:272", function()
		started = started + 1
		return function()
			finished = finished + 1
		end
	end)

	registrations[1].action()
	registrations[1].action()

	assert.are.equal(1, started)
	assert.are.equal(1, finished)
end)

it("does not restart on mouse release after a modifier ended the interaction", function()
	local started = 0
	local finished = 0
	mouse_release.bind("SUPER + mouse:273", function()
		started = started + 1
		return function()
			finished = finished + 1
		end
	end)

	registrations[1].action()
	assert.is_true(mouse_release.finish_all())
	registrations[1].action()

	assert.are.equal(1, started)
	assert.are.equal(1, finished)
	assert.is_false(mouse_release.finish_all())
end)
