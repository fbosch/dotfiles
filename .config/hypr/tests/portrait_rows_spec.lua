local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/portrait_rows_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local registered_layout
local cursor_position

_G.hl = {
	layout = {
		register = function(name, layout)
			registered_layout = { name = name, layout = layout }
		end,
	},
	get_cursor_pos = function()
		return cursor_position
	end,
}

local function make_target(index, workspace, active)
	return {
		index = index,
		window = {
			active = active or false,
			address = "0x" .. tostring(index),
			stable_id = index,
			monitor = { name = "HDMI-A-2" },
			workspace = { name = workspace },
		},
		place = function(self, box)
			self.placed = { x = box.x, y = box.y, w = box.w, h = box.h }
		end,
	}
end

local function make_context(targets)
	local area = { x = 10, y = 20, w = 120, h = 300 }

	return {
		area = area,
		targets = targets,
		split = function(_, box, side, ratio)
			if side == "top" then
				return { x = box.x, y = box.y, w = box.w, h = box.h * ratio }
			end

			return { x = box.x, y = box.y + box.h * (1 - ratio), w = box.w, h = box.h * ratio }
		end,
		row = function(_, index, count)
			return { x = area.x, y = area.y + area.h * (index - 1) / count, w = area.w, h = area.h / count }
		end,
	}
end

local function assert_box(actual, expected)
	for key, value in pairs(expected) do
		assert.is_true(math.abs(actual[key] - value) < 0.000001)
	end
end

describe("portrait_rows layout", function()
	before_each(function()
		registered_layout = nil
		cursor_position = nil
		_G.__PORTRAIT_ROWS_DISABLE_STATE = true
		package.loaded["layouts.portrait_rows"] = nil
		require("layouts.portrait_rows")
	end)

	it("registers the layout callbacks", function()
		assert.are.equal("portrait_rows", registered_layout.name)
		assert.are.equal("function", type(registered_layout.layout.recalculate))
		assert.are.equal("function", type(registered_layout.layout.layout_msg))
		assert.are.equal("function", type(registered_layout.layout.resize))
	end)

	it("gives two portrait windows the default one-third ratio", function()
		local top = make_target(1, "two-rows", true)
		local bottom = make_target(2, "two-rows")
		registered_layout.layout.recalculate(make_context({ top, bottom }))

		assert_box(top.placed, { x = 10, y = 20, w = 120, h = 100 })
		assert_box(bottom.placed, { x = 10, y = 120, w = 120, h = 200 })
	end)

	it("moves the active row to the cursor position", function()
		local top = make_target(1, "cursor-order", true)
		local bottom = make_target(2, "cursor-order")
		local context = make_context({ top, bottom })
		registered_layout.layout.recalculate(context)

		cursor_position = { x = 20, y = 360 }
		registered_layout.layout.layout_msg(context, "place-at-cursor")
		registered_layout.layout.recalculate(context)

		assert_box(bottom.placed, { x = 10, y = 20, w = 120, h = 100 })
		assert_box(top.placed, { x = 10, y = 120, w = 120, h = 200 })
	end)

	it("resizes the active row through a layout message", function()
		local first = make_target(1, "resize-message", true)
		local second = make_target(2, "resize-message")
		local context = make_context({ first, second })
		registered_layout.layout.layout_msg(context, "resize-y 15")
		registered_layout.layout.recalculate(context)

		assert_box(first.placed, { x = 10, y = 20, w = 120, h = 115 })
		assert_box(second.placed, { x = 10, y = 135, w = 120, h = 185 })
	end)
end)
