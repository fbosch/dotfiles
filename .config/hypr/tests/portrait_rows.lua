local script_path = arg[0] or ""
local config_dir = script_path:match("^(.*)/tests/portrait_rows%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local registered_layout = nil

hl = {
	layout = {
		register = function(name, layout)
			registered_layout = { name = name, layout = layout }
		end,
	},
}

local function make_target(index, active)
	return {
		index = index,
		window = { active = active or false },
		placed = nil,
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

			if side == "bottom" then
				return { x = box.x, y = box.y + box.h * (1 - ratio), w = box.w, h = box.h * ratio }
			end

			error("unsupported split side: " .. tostring(side))
		end,
		row = function(_, index, count)
			return { x = area.x, y = area.y + area.h * (index - 1) / count, w = area.w, h = area.h / count }
		end,
	}
end

local function assert_equal(actual, expected, message)
	if type(actual) == "number" and type(expected) == "number" and math.abs(actual - expected) < 0.000001 then
		return
	end

	if actual ~= expected then
		error(string.format("%s: expected %s, got %s", message, tostring(expected), tostring(actual)), 2)
	end
end

local function assert_box(actual, expected, message)
	assert_equal(actual.x, expected.x, message .. " x")
	assert_equal(actual.y, expected.y, message .. " y")
	assert_equal(actual.w, expected.w, message .. " w")
	assert_equal(actual.h, expected.h, message .. " h")
end

local function run(name, callback)
	local ok, err = pcall(callback)
	if not ok then
		io.stderr:write("FAIL " .. name .. "\n" .. err .. "\n")
		os.exit(1)
	end

	print("PASS " .. name)
end

require("layouts.portrait_rows")

run("registers lua portrait_rows layout", function()
	assert_equal(registered_layout.name, "portrait_rows", "registered layout name")
	assert_equal(type(registered_layout.layout.recalculate), "function", "registered recalculate")
end)

run("two windows use one-third top and two-thirds bottom", function()
	local top = make_target(1, true)
	local bottom = make_target(2)
	registered_layout.layout.recalculate(make_context({ top, bottom }))

	assert_box(top.placed, { x = 10, y = 20, w = 120, h = 100 }, "top target")
	assert_box(bottom.placed, { x = 10, y = 120, w = 120, h = 200 }, "bottom target")
end)

run("three windows use equal vertical thirds", function()
	local first = make_target(1, true)
	local second = make_target(2)
	local third = make_target(3)
	registered_layout.layout.recalculate(make_context({ first, second, third }))

	assert_box(first.placed, { x = 10, y = 20, w = 120, h = 100 }, "first target")
	assert_box(second.placed, { x = 10, y = 120, w = 120, h = 100 }, "second target")
	assert_box(third.placed, { x = 10, y = 220, w = 120, h = 100 }, "third target")
end)

run("active target does not override target order", function()
	local first = make_target(1)
	local second = make_target(2)
	local third = make_target(3, true)
	registered_layout.layout.recalculate(make_context({ first, second, third }))

	assert_box(first.placed, { x = 10, y = 20, w = 120, h = 100 }, "first target")
	assert_box(second.placed, { x = 10, y = 120, w = 120, h = 100 }, "second target")
	assert_box(third.placed, { x = 10, y = 220, w = 120, h = 100 }, "active target")
end)

run("four windows degrade to equal vertical rows", function()
	local targets = { make_target(1), make_target(2), make_target(3), make_target(4) }
	registered_layout.layout.recalculate(make_context(targets))

	assert_box(targets[1].placed, { x = 10, y = 20, w = 120, h = 75 }, "first target")
	assert_box(targets[4].placed, { x = 10, y = 245, w = 120, h = 75 }, "fourth target")
end)
