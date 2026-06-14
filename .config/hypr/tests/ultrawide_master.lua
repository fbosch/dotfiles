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

_G.__ULTRAWIDE_MASTER_DISABLE_STATE = true

local function make_target(index, active)
	return {
		index = index,
		window = { active = active or false, address = "0x" .. tostring(index), stable_id = index, monitor = { name = "DP-2" }, workspace = { name = "ultrawide-test" } },
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

local function set_monitor(target, monitor)
	target.window.monitor.name = monitor
	return target
end

local function make_context(targets, workspace_name)
	workspace_counter = workspace_counter + 1
	local workspace = { name = workspace_name or "ultrawide-test-" .. tostring(workspace_counter) }
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
	assert_equal(type(registered_layout.layout.resize), "function", "registered resize")
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

run("hdmi fallback uses portrait rows", function()
	local top = set_monitor(make_target(1, true), "HDMI-A-2")
	local bottom = set_monitor(make_target(2), "HDMI-A-2")
	registered_layout.layout.recalculate(make_context({ top, bottom }))

	assert_box(top.placed, { x = 10, y = 20, w = 1000, h = 500 / 3 }, "top target")
	assert_box(bottom.placed, { x = 10, y = 20 + 500 / 3, w = 1000, h = 1000 / 3 }, "bottom target")
end)

run("known active geometry reorders columns", function()
	local first = make_target(1, true)
	local second = make_target(2)
	local ctx = make_context({ first, second })
	registered_layout.layout.recalculate(ctx)
	set_geometry(first, 850)
	set_geometry(second, 200)
	registered_layout.layout.recalculate(ctx)

	assert_box(second.placed, { x = 10, y = 20, w = 670, h = 500 }, "left target")
	assert_box(first.placed, { x = 680, y = 20, w = 330, h = 500 }, "right target")
end)

run("spawned active window does not reorder existing columns", function()
	local first = set_geometry(make_target(1, true), 100)
	local second = set_geometry(make_target(2), 800)
	local workspace = "spawn-no-reorder"
	registered_layout.layout.recalculate(make_context({ first, second }, workspace))

	first.window.active = false
	local third = set_geometry(make_target(3, true), 10)
	third.index = 2
	third.window.address = nil
	third.window.stable_id = nil
	second.index = 3
	second.window.stable_id = 3
	registered_layout.layout.recalculate(make_context({ first, third, second }, workspace))

	assert_box(first.placed, { x = 10, y = 20, w = 300, h = 500 }, "left target")
	assert_box(third.placed, { x = 310, y = 20, w = 400, h = 500 }, "spawned target")
	assert_box(second.placed, { x = 710, y = 20, w = 300, h = 500 }, "right target")
end)

run("dragged portrait window entering from left lands leftmost", function()
	local ultrawide_layout = registered_layout.layout
	local portrait_layout = require("layouts.portrait_rows")
	registered_layout.layout = ultrawide_layout

	local dragged = set_monitor(make_target(1, true), "HDMI-A-2")
	local source_other = set_monitor(make_target(2), "HDMI-A-2")
	portrait_layout.recalculate({ area = { x = -900, y = 0, w = 800, h = 1200 }, targets = { dragged, source_other } })

	local workspace = "cross-monitor-drag-left"
	dragged.window.workspace = { name = workspace }
	dragged.window.monitor.name = "DP-2"
	set_geometry(dragged, -900, 800)

	local left = make_target(3)
	local right = make_target(4)
	ultrawide_layout.recalculate(make_context({ left, right, dragged }, workspace))

	assert_box(dragged.placed, { x = 10, y = 20, w = 300, h = 500 }, "dragged target")
	assert_box(left.placed, { x = 310, y = 20, w = 400, h = 500 }, "left target")
	assert_box(right.placed, { x = 710, y = 20, w = 300, h = 500 }, "right target")
end)

run("stale active HDMI monitor does not force DP workspace into rows", function()
	local ultrawide_layout = registered_layout.layout
	local portrait_layout = require("layouts.portrait_rows")
	registered_layout.layout = ultrawide_layout

	local dragged = set_monitor(make_target(1, true), "HDMI-A-2")
	local source_other = set_monitor(make_target(2), "HDMI-A-2")
	portrait_layout.recalculate({ area = { x = 2000, y = 0, w = 800, h = 1200 }, targets = { dragged, source_other } })

	local workspace = "mixed-monitor-drag"
	dragged.window.workspace = { name = workspace }
	set_geometry(dragged, 2000)

	local existing = make_target(3)
	ultrawide_layout.recalculate(make_context({ dragged, existing }, workspace))

	assert_box(dragged.placed, { x = 10, y = 20, w = 670, h = 500 }, "dragged target")
	assert_box(existing.placed, { x = 680, y = 20, w = 330, h = 500 }, "existing target")
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

run("future resize callback grows active column", function()
	local first = set_geometry(make_target(1, true), 100)
	local second = set_geometry(make_target(2), 800)
	local ctx = make_context({ first, second })

	registered_layout.layout.resize(ctx, first, { x = 0.05 }, nil)
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 720, h = 500 }, "left target")
	assert_box(second.placed, { x = 730, y = 20, w = 280, h = 500 }, "right target")
end)

run("pixel resize message scales by layout width", function()
	local first = set_geometry(make_target(1, true), 100)
	local second = set_geometry(make_target(2), 800)
	local ctx = make_context({ first, second })

	registered_layout.layout.layout_msg(ctx, "resize-x 50")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 720, h = 500 }, "left target")
	assert_box(second.placed, { x = 730, y = 20, w = 280, h = 500 }, "right target")
end)

run("absolute resize follows cursor boundary", function()
	local first = set_geometry(make_target(1, true), 100)
	local second = set_geometry(make_target(2), 800)
	local ctx = make_context({ first, second })

	registered_layout.layout.layout_msg(ctx, "resize-x-at right 760")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 750, h = 500 }, "left target")
	assert_box(second.placed, { x = 760, y = 20, w = 250, h = 500 }, "right target")
end)

run("absolute resize uses internal boundary on outer edge", function()
	local first = set_geometry(make_target(1), 100)
	local second = set_geometry(make_target(2, true), 800)
	local ctx = make_context({ first, second })

	registered_layout.layout.layout_msg(ctx, "resize-x-at right 600")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 590, h = 500 }, "left target")
	assert_box(second.placed, { x = 600, y = 20, w = 410, h = 500 }, "right target")
end)

run("hdmi fallback supports vertical absolute resize", function()
	local top = set_monitor(make_target(1, true), "HDMI-A-2")
	local bottom = set_monitor(make_target(2), "HDMI-A-2")
	local ctx = make_context({ top, bottom })

	registered_layout.layout.layout_msg(ctx, "resize-y-at down 220")
	registered_layout.layout.recalculate(ctx)

	assert_box(top.placed, { x = 10, y = 20, w = 1000, h = 200 }, "top target")
	assert_box(bottom.placed, { x = 10, y = 220, w = 1000, h = 300 }, "bottom target")
end)

run("resize does not reorder by stale geometry", function()
	local first = set_geometry(make_target(1, true), 850)
	local second = set_geometry(make_target(2), 200)
	local ctx = make_context({ first, second })

	registered_layout.layout.layout_msg(ctx, "resize-x 50")
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

run("manual column ratios survive layout module reload", function()
	_G.__ULTRAWIDE_MASTER_DISABLE_STATE = nil
	_G.__ULTRAWIDE_MASTER_STATE_FILE = os.tmpname()
	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")

	local workspace = "persisted-ratio-test"
	local first = set_geometry(make_target(1, true), 100)
	local second = set_geometry(make_target(2), 800)
	local ctx = make_context({ first, second }, workspace)

	registered_layout.layout.layout_msg(ctx, "resize-x 50")
	registered_layout.layout.recalculate(ctx)
	assert_box(first.placed, { x = 10, y = 20, w = 720, h = 500 }, "resized left target")

	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")

	local reloaded_first = set_geometry(make_target(1, true), 100)
	local reloaded_second = set_geometry(make_target(2), 800)
	local reloaded_ctx = make_context({ reloaded_first, reloaded_second }, workspace)
	registered_layout.layout.recalculate(reloaded_ctx)

	assert_box(reloaded_first.placed, { x = 10, y = 20, w = 720, h = 500 }, "reloaded left target")
	assert_box(reloaded_second.placed, { x = 730, y = 20, w = 280, h = 500 }, "reloaded right target")
	registered_layout.layout.layout_msg(reloaded_ctx, "reset")
	os.remove(_G.__ULTRAWIDE_MASTER_STATE_FILE)
	_G.__ULTRAWIDE_MASTER_STATE_FILE = nil
	_G.__ULTRAWIDE_MASTER_DISABLE_STATE = true
end)
