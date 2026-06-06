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
		window = { active = active or false, monitor = { name = "HDMI-A-2" } },
		placed = nil,
		place = function(self, box)
			self.placed = { x = box.x, y = box.y, w = box.w, h = box.h }
		end,
	}
end

local function make_workspace_target(index, workspace, active)
	local target = make_target(index, active)
	target.window.workspace = { name = workspace }
	return target
end

local function make_dp_target(index)
	local target = make_target(index)
	target.window.monitor.name = "DP-2"
	return target
end

local function set_geometry(target, y, height)
	target.window.at = { x = 0, y = y }
	target.window.size = { x = 100, y = height or 100 }
	return target
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
	assert_equal(type(registered_layout.layout.layout_msg), "function", "registered layout_msg")
	assert_equal(type(registered_layout.layout.resize), "function", "registered resize")
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

run("vertical window position controls row order when available", function()
	local first = set_geometry(make_workspace_target(1, "position-order", true), 120)
	local second = set_geometry(make_workspace_target(2, "position-order"), 20)
	local third = set_geometry(make_workspace_target(3, "position-order"), 220)
	registered_layout.layout.recalculate(make_context({ first, second, third }))

	assert_box(second.placed, { x = 10, y = 20, w = 120, h = 100 }, "top target")
	assert_box(first.placed, { x = 10, y = 120, w = 120, h = 100 }, "middle target")
	assert_box(third.placed, { x = 10, y = 220, w = 120, h = 100 }, "bottom target")
end)

run("four windows degrade to equal vertical rows", function()
	local targets = { make_target(1), make_target(2), make_target(3), make_target(4) }
	registered_layout.layout.recalculate(make_context(targets))

	assert_box(targets[1].placed, { x = 10, y = 20, w = 120, h = 75 }, "first target")
	assert_box(targets[4].placed, { x = 10, y = 245, w = 120, h = 75 }, "fourth target")
end)

run("dp monitor does not use portrait two-window ratio", function()
	local first = make_dp_target(1)
	local second = make_dp_target(2)
	registered_layout.layout.recalculate(make_context({ first, second }))

	assert_box(first.placed, { x = 10, y = 20, w = 120, h = 150 }, "first dp target")
	assert_box(second.placed, { x = 10, y = 170, w = 120, h = 150 }, "second dp target")
end)

run("resize-down grows active row into next row", function()
	local first = make_workspace_target(1, "resize-down", true)
	local second = make_workspace_target(2, "resize-down")
	local ctx = make_context({ first, second })

	registered_layout.layout.layout_msg(ctx, "resize-down")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 120, h = 115 }, "first resized target")
	assert_box(second.placed, { x = 10, y = 135, w = 120, h = 185 }, "second resized target")
end)

run("resize-up grows active row into previous row", function()
	local first = make_workspace_target(1, "resize-up")
	local second = make_workspace_target(2, "resize-up", true)
	local ctx = make_context({ first, second })

	registered_layout.layout.layout_msg(ctx, "resize-up")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 120, h = 85 }, "first resized target")
	assert_box(second.placed, { x = 10, y = 105, w = 120, h = 215 }, "second resized target")
end)

run("future resize callback grows active row", function()
	local first = make_workspace_target(1, "future-resize", true)
	local second = make_workspace_target(2, "future-resize")
	local ctx = make_context({ first, second })

	registered_layout.layout.resize(ctx, first, { y = 0.05 }, nil)
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 120, h = 115 }, "first resized target")
	assert_box(second.placed, { x = 10, y = 135, w = 120, h = 185 }, "second resized target")
end)

run("pixel resize message scales by layout height", function()
	local first = make_workspace_target(1, "pixel-resize", true)
	local second = make_workspace_target(2, "pixel-resize")
	local ctx = make_context({ first, second })

	registered_layout.layout.layout_msg(ctx, "resize-y 15")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 120, h = 115 }, "first resized target")
	assert_box(second.placed, { x = 10, y = 135, w = 120, h = 185 }, "second resized target")
end)

run("absolute resize follows cursor boundary", function()
	local first = make_workspace_target(1, "absolute-resize", true)
	local second = make_workspace_target(2, "absolute-resize")
	local ctx = make_context({ first, second })

	registered_layout.layout.layout_msg(ctx, "resize-y-at down 155")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 120, h = 135 }, "first resized target")
	assert_box(second.placed, { x = 10, y = 155, w = 120, h = 165 }, "second resized target")
end)

run("absolute resize uses internal boundary on outer edge", function()
	local first = make_workspace_target(1, "absolute-outer-resize")
	local second = make_workspace_target(2, "absolute-outer-resize", true)
	local ctx = make_context({ first, second })

	registered_layout.layout.layout_msg(ctx, "resize-y-at down 185")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 120, h = 165 }, "first resized target")
	assert_box(second.placed, { x = 10, y = 185, w = 120, h = 135 }, "second resized target")
end)

run("resize does not reorder by stale geometry", function()
	local first = set_geometry(make_workspace_target(1, "resize-no-reorder", true), 220)
	local second = set_geometry(make_workspace_target(2, "resize-no-reorder"), 20)
	local ctx = make_context({ first, second })

	registered_layout.layout.layout_msg(ctx, "resize-y 15")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 120, h = 115 }, "first resized target")
	assert_box(second.placed, { x = 10, y = 135, w = 120, h = 185 }, "second resized target")
end)

run("swapnext moves active row despite old geometry", function()
	local first = set_geometry(make_workspace_target(1, "swapnext", true), 20)
	local second = set_geometry(make_workspace_target(2, "swapnext"), 120)
	local ctx = make_context({ first, second })

	registered_layout.layout.recalculate(ctx)
	registered_layout.layout.layout_msg(ctx, "swapnext")
	registered_layout.layout.recalculate(ctx)

	assert_box(second.placed, { x = 10, y = 20, w = 120, h = 100 }, "top target")
	assert_box(first.placed, { x = 10, y = 120, w = 120, h = 200 }, "bottom target")
end)

run("ignores unrelated layout messages", function()
	local first = make_workspace_target(1, "ignored-layout-msg")
	local second = make_workspace_target(2, "ignored-layout-msg", true)
	local ctx = make_context({ first, second })

	assert_equal(registered_layout.layout.layout_msg(ctx, "=[C]-1"), true, "ignored message result")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 120, h = 100 }, "first target")
	assert_box(second.placed, { x = 10, y = 120, w = 120, h = 200 }, "second target")
end)
