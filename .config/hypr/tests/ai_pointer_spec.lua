local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/ai_pointer_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local requests = {}

package.loaded["lib.ags"] = {
	request = function(component, payload)
		table.insert(requests, { component = component, payload = payload })
	end,
}

local function cursor_position()
	return { x = 100.8, y = 200.4 }
end

_G.hl = { get_cursor_pos = cursor_position }

local ai_pointer = require("actions.ai-pointer")

before_each(function()
	requests = {}
	hl.get_cursor_pos = cursor_position
	ai_pointer.consume_super_chord()
end)

it("latches the Super chord from pointer start until explicit consumption", function()
	ai_pointer.start()

	assert.is_true(ai_pointer.has_super_chord())
	assert.is_true(ai_pointer.consume_super_chord())
	assert.is_false(ai_pointer.has_super_chord())
	assert.is_false(ai_pointer.consume_super_chord())
	assert.are.equal("ai-pointer", requests[1].component)
	assert.are.same({ action = "start", x = 100, y = 200 }, requests[1].payload)
end)

it("does not latch when a cursor position is unavailable", function()
	hl.get_cursor_pos = function()
		return nil
	end

	ai_pointer.start()

	assert.is_false(ai_pointer.has_super_chord())
	assert.are.equal(0, #requests)
end)
