local script_path = arg[0] or ""
local config_dir = script_path:match("^(.*)/tests/ultrawide_master%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local registered_layout = nil
local workspace_counter = 0

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
		window = { active = active or false, monitor = { name = "DP-2" }, workspace = { name = "ultrawide-test" } },
		placed = nil,
		place = function(self, box)
			self.placed = { x = box.x, y = box.y, w = box.w, h = box.h }
		end,
	}
end

local function set_geometry(target, x, width)
	target.window.at = { x = x, y = 0 }
	target.window.size = { x = width or 100, y = 100 }
	return target
end

local function make_context(targets)
	workspace_counter = workspace_counter + 1
	local workspace = { name = "ultrawide-test-" .. tostring(workspace_counter) }
	for index = 1, #targets do
		targets[index].window.workspace = workspace
	end

	return { area = { x = 10, y = 20, w = 1000, h = 500 }, targets = targets }
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

require("layouts.ultrawide_master")

run("registers lua ultrawide_master layout", function()
	assert_equal(registered_layout.name, "ultrawide_master", "registered layout name")
	assert_equal(type(registered_layout.layout.recalculate), "function", "registered recalculate")
	assert_equal(type(registered_layout.layout.layout_msg), "function", "registered layout_msg")
end)

run("two windows lay out left to right", function()
	local left = make_target(1, true)
	local right = make_target(2)
	registered_layout.layout.recalculate(make_context({ left, right }))

	assert_box(left.placed, { x = 10, y = 20, w = 670, h = 500 }, "left target")
	assert_box(right.placed, { x = 680, y = 20, w = 330, h = 500 }, "right target")
end)

run("three windows use left center right columns", function()
	local left = make_target(1, true)
	local center = make_target(2)
	local right = make_target(3)
	registered_layout.layout.recalculate(make_context({ left, center, right }))

	assert_box(left.placed, { x = 10, y = 20, w = 300, h = 500 }, "left target")
	assert_box(center.placed, { x = 310, y = 20, w = 400, h = 500 }, "center target")
	assert_box(right.placed, { x = 710, y = 20, w = 300, h = 500 }, "right target")
end)

run("dragged active window moves to cursor column", function()
	local first = set_geometry(make_target(1, true), 850)
	local second = set_geometry(make_target(2), 200)
	local ctx = make_context({ first, second })
	registered_layout.layout.recalculate(ctx)

	assert_box(second.placed, { x = 10, y = 20, w = 670, h = 500 }, "left target")
	assert_box(first.placed, { x = 680, y = 20, w = 330, h = 500 }, "right target")
end)

run("swapnext moves active column despite old geometry", function()
	local first = set_geometry(make_target(1, true), 100)
	local second = set_geometry(make_target(2), 800)
	local ctx = make_context({ first, second })

	registered_layout.layout.recalculate(ctx)
	registered_layout.layout.layout_msg(ctx, "swapnext")
	registered_layout.layout.recalculate(ctx)

	assert_box(second.placed, { x = 10, y = 20, w = 670, h = 500 }, "left target")
	assert_box(first.placed, { x = 680, y = 20, w = 330, h = 500 }, "right target")
end)

run("swapprev moves middle active column left", function()
	local first = set_geometry(make_target(1), 100)
	local second = set_geometry(make_target(2, true), 400)
	local third = set_geometry(make_target(3), 800)
	local ctx = make_context({ first, second, third })

	registered_layout.layout.recalculate(ctx)
	registered_layout.layout.layout_msg(ctx, "swapprev")
	registered_layout.layout.recalculate(ctx)

	assert_box(second.placed, { x = 10, y = 20, w = 300, h = 500 }, "left target")
	assert_box(first.placed, { x = 310, y = 20, w = 400, h = 500 }, "center target")
	assert_box(third.placed, { x = 710, y = 20, w = 300, h = 500 }, "right target")
end)

run("swapnext on rightmost active column is stable", function()
	local first = set_geometry(make_target(1), 100)
	local second = set_geometry(make_target(2), 400)
	local third = set_geometry(make_target(3, true), 800)
	local ctx = make_context({ first, second, third })

	registered_layout.layout.recalculate(ctx)
	registered_layout.layout.layout_msg(ctx, "swapnext")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 300, h = 500 }, "left target")
	assert_box(second.placed, { x = 310, y = 20, w = 400, h = 500 }, "center target")
	assert_box(third.placed, { x = 710, y = 20, w = 300, h = 500 }, "right target")
end)

run("resize-right grows active column into next column", function()
	local first = set_geometry(make_target(1, true), 100)
	local second = set_geometry(make_target(2), 800)
	local ctx = make_context({ first, second })

	registered_layout.layout.layout_msg(ctx, "resize-right")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 720, h = 500 }, "left target")
	assert_box(second.placed, { x = 730, y = 20, w = 280, h = 500 }, "right target")
end)

run("resize-left grows active column into previous column", function()
	local first = set_geometry(make_target(1), 100)
	local second = set_geometry(make_target(2, true), 800)
	local ctx = make_context({ first, second })

	registered_layout.layout.layout_msg(ctx, "resize-left")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 620, h = 500 }, "left target")
	assert_box(second.placed, { x = 630, y = 20, w = 380, h = 500 }, "right target")
end)

run("resize-right on right edge moves boundary right", function()
	local first = set_geometry(make_target(1), 100)
	local second = set_geometry(make_target(2, true), 800)
	local ctx = make_context({ first, second })

	registered_layout.layout.layout_msg(ctx, "resize-right")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 720, h = 500 }, "left target")
	assert_box(second.placed, { x = 730, y = 20, w = 280, h = 500 }, "right target")
end)

run("resize-left on left edge moves boundary left", function()
	local first = set_geometry(make_target(1, true), 100)
	local second = set_geometry(make_target(2), 800)
	local ctx = make_context({ first, second })

	registered_layout.layout.layout_msg(ctx, "resize-left")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 620, h = 500 }, "left target")
	assert_box(second.placed, { x = 630, y = 20, w = 380, h = 500 }, "right target")
end)

run("reset restores default column ratios", function()
	local first = set_geometry(make_target(1, true), 100)
	local second = set_geometry(make_target(2), 800)
	local ctx = make_context({ first, second })

	registered_layout.layout.layout_msg(ctx, "resize-right")
	registered_layout.layout.layout_msg(ctx, "reset")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 670, h = 500 }, "left target")
	assert_box(second.placed, { x = 680, y = 20, w = 330, h = 500 }, "right target")
end)
