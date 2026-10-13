local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/window_state_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local state = require("lib.window.state")

describe("window state predicates", function()
	local original_hl
	before_each(function()
		original_hl = _G.hl
	end)
	after_each(function()
		_G.hl = original_hl
	end)

	it("returns the core active window without enumerating windows", function()
		local active = { content_type = "none" }
		_G.hl = {
			get_active_window = function()
				return active
			end,
			get_windows = function()
				error("unexpected enumeration")
			end,
		}
		assert.equal(active, state.active())
	end)

	it("applies game restrictions to the supplied target rather than focus", function()
		_G.hl = {
			get_active_window = function()
				return { content_type = "game" }
			end,
		}
		assert.is_false(state.is_game({ content_type = "none" }))
		assert.is_true(state.is_game({ content_type = "game" }))
		assert.is_false(state.is_game(nil))
	end)
end)
