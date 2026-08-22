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
	assert.is_true(ai_pointer.start())

	assert.is_true(ai_pointer.has_super_chord())
	assert.is_true(ai_pointer.consume_super_chord())
	assert.is_false(ai_pointer.has_super_chord())
	assert.is_false(ai_pointer.consume_super_chord())
	assert.are.equal("ai-pointer", requests[1].component)
	assert.are.same({ action = "start", x = 100, y = 200 }, requests[1].payload)
	assert.is_true(ai_pointer.finish())
	assert.are.same({ action = "finish", x = 100, y = 200 }, requests[2].payload)
end)

it("does not latch when a cursor position is unavailable", function()
	hl.get_cursor_pos = function()
		return nil
	end

	assert.is_false(ai_pointer.start())

	assert.is_false(ai_pointer.has_super_chord())
	assert.are.equal(0, #requests)
end)

it("uses the Super middle-button release binding", function()
	local keybinds_path = config_dir .. "/keybinds.lua"
	local file = assert(io.open(keybinds_path, "r"))
	local keybinds = file:read("*a")
	file:close()

	assert.is_truthy(keybinds:find('mouse_release.bind(main("mouse:274")', 1, true))
	assert.is_nil(keybinds:find('mouse_release.bind("ALT + mouse:274"', 1, true))
end)
