local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/ultrawide_master_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local registered_layout = nil
local workspace_counter = 0
local cursor_position = nil
local active_window = nil

_G.hl = {
	layout = {
		register = function(name, layout)
			registered_layout = { name = name, layout = layout }
		end,
	},
	get_cursor_pos = function()
		return cursor_position
	end,
	get_active_window = function()
		return active_window
	end,
}

_G.__ULTRAWIDE_MASTER_DISABLE_STATE = true

local monitor_role = require("lib.monitor_role")
local ordered_axis = require("layouts.shared.ordered_axis")
local persistent_state = require("layouts.shared.persistent_state")
local intents

local function make_target(index, active)
	return {
		index = index,
		window = {
			active = active or false,
			address = "0x" .. tostring(index),
			stable_id = index,
			monitor = { name = "DP-2" },
			workspace = { name = "ultrawide-test" },
		},
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

local function make_context_with_workspace(targets, workspace)
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

local function count_state_writes(path, callback)
	local original_open = io.open
	local writes = 0
	io.open = function(open_path, mode, ...)
		if (open_path == path or open_path == path .. ".tmp") and mode == "w" then
			writes = writes + 1
		end

		return original_open(open_path, mode, ...)
	end

	local ok, err = pcall(callback)
	io.open = original_open
	if ok == false then
		error(err, 0)
	end

	return writes
end

local function load_layout()
	registered_layout = nil
	workspace_counter = 0
	cursor_position = nil
	active_window = nil
	_G.__ULTRAWIDE_MASTER_DISABLE_STATE = true
	package.loaded["layouts.ultrawide_master"] = nil
	package.loaded["layouts.portrait_rows"] = nil
	package.loaded["layouts.shared.ordered_axis"] = nil
	package.loaded["layouts.shared.order_state"] = nil
	package.loaded["layouts.shared.intents"] = nil
	intents = require("layouts.shared.intents")
	require("layouts.ultrawide_master")
end

before_each(load_layout)

after_each(function()
	if _G.__ULTRAWIDE_MASTER_STATE_FILE then
		os.remove(_G.__ULTRAWIDE_MASTER_STATE_FILE)
	end
	_G.__ULTRAWIDE_MASTER_STATE_FILE = nil
	_G.__ULTRAWIDE_MASTER_DISABLE_STATE = true
end)

local function run(name, callback)
	it(name, callback)
end

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

run("nearest slot center selects every unequal ultrawide column", function()
	local ratios = { 0.3, 0.4, 0.3 }
	assert_equal(ordered_axis.nearest_slot_index(160, ratios, 10, 1000), 1, "left slot")
	assert_equal(ordered_axis.nearest_slot_index(510, ratios, 10, 1000), 2, "center slot")
	assert_equal(ordered_axis.nearest_slot_index(860, ratios, 10, 1000), 3, "right slot")
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
	cursor_position = { x = 900, y = 30 }
	registered_layout.layout.layout_msg(ctx, "place-at-cursor")
	cursor_position = nil
	registered_layout.layout.recalculate(ctx)

	assert_box(second.placed, { x = 10, y = 20, w = 670, h = 500 }, "left target")
	assert_box(first.placed, { x = 680, y = 20, w = 330, h = 500 }, "right target")
end)

run("newly tiled window uses nearest resulting ultrawide slot center", function()
	local left = make_target(301)
	local right = make_target(302)
	local workspace = "float-to-tile-nearest-right"
	registered_layout.layout.recalculate(make_context({ left, right }, workspace))

	local tiled = make_target(303, true)
	local ctx = make_context({ left, right, tiled }, workspace)
	intents.record_placement_intent(tiled.window, {
		layout_name = "ultrawide_master",
		workspace_key = workspace,
		monitor_role = monitor_role.ultrawide,
		axis = "x",
		position = 900,
	})
	registered_layout.layout.recalculate(ctx)

	assert_box(left.placed, { x = 10, y = 20, w = 300, h = 500 }, "left target")
	assert_box(right.placed, { x = 310, y = 20, w = 400, h = 500 }, "center target")
	assert_box(tiled.placed, { x = 710, y = 20, w = 300, h = 500 }, "newly tiled target")
	assert_equal(intents.placement_intent_for_window(tiled.window), nil, "consumed intent")
end)

run("retiled window moves from its previous order to the nearest slot", function()
	local retiled = make_target(321, true)
	local middle = make_target(322)
	local right = make_target(323)
	local workspace = "retile-nearest-right"
	registered_layout.layout.recalculate(make_context({ retiled, middle, right }, workspace))
	registered_layout.layout.recalculate(make_context({ middle, right }, workspace))

	intents.record_placement_intent(retiled.window, {
		layout_name = "ultrawide_master",
		workspace_key = workspace,
		monitor_role = monitor_role.ultrawide,
		axis = "x",
		position = 900,
	})
	registered_layout.layout.recalculate(make_context({ retiled, middle, right }, workspace))

	assert_box(middle.placed, { x = 10, y = 20, w = 300, h = 500 }, "left target")
	assert_box(right.placed, { x = 310, y = 20, w = 400, h = 500 }, "center target")
	assert_box(retiled.placed, { x = 710, y = 20, w = 300, h = 500 }, "retiled target")
end)

run("retiled placement ignores retained missing identities", function()
	local missing = make_target(331)
	local retiled = make_target(332, true)
	local existing = make_target(333)
	local workspace = "retile-stale-order"
	registered_layout.layout.recalculate(make_context({ missing, retiled, existing }, workspace))
	registered_layout.layout.recalculate(make_context({ retiled, existing }, workspace))

	intents.record_placement_intent(retiled.window, {
		layout_name = "ultrawide_master",
		workspace_key = workspace,
		monitor_role = monitor_role.ultrawide,
		axis = "x",
		position = 900,
	})
	registered_layout.layout.recalculate(make_context({ retiled, existing }, workspace))

	assert_box(existing.placed, { x = 10, y = 20, w = 670, h = 500 }, "left target")
	assert_box(retiled.placed, { x = 680, y = 20, w = 330, h = 500 }, "retiled target")
end)

run("single tiled column consumes placement intent", function()
	local tiled = make_target(341, true)
	local workspace = "single-placement"
	local ctx = make_context({ tiled }, workspace)
	intents.record_placement_intent(tiled.window, {
		layout_name = "ultrawide_master",
		workspace_key = workspace,
		monitor_role = monitor_role.ultrawide,
		axis = "x",
		position = 900,
	})
	registered_layout.layout.recalculate(ctx)

	assert_equal(intents.placement_intent_for_window(tiled.window), nil, "consumed intent")
	local second = make_target(342)
	registered_layout.layout.recalculate(make_context({ tiled, second }, workspace))
	assert_box(tiled.placed, { x = 10, y = 20, w = 670, h = 500 }, "existing target")
	assert_box(second.placed, { x = 680, y = 20, w = 330, h = 500 }, "new target")
end)

run("visible no-op placement preserves hidden identity order", function()
	local first = make_target(351)
	local retiled = make_target(352, true)
	local hidden = make_target(353)
	local last = make_target(354)
	local workspace = "hidden-order"
	registered_layout.layout.recalculate(make_context({ first, retiled, hidden, last }, workspace))
	registered_layout.layout.recalculate(make_context({ first, retiled, last }, workspace))

	intents.record_placement_intent(retiled.window, {
		layout_name = "ultrawide_master",
		workspace_key = workspace,
		monitor_role = monitor_role.ultrawide,
		axis = "x",
		position = 510,
	})
	registered_layout.layout.recalculate(make_context({ first, retiled, last }, workspace))
	registered_layout.layout.recalculate(make_context({ first, retiled, hidden, last }, workspace))

	assert_box(first.placed, { x = 10, y = 20, w = 250, h = 500 }, "first target")
	assert_box(retiled.placed, { x = 260, y = 20, w = 250, h = 500 }, "retiled target")
	assert_box(hidden.placed, { x = 510, y = 20, w = 250, h = 500 }, "hidden target")
	assert_box(last.placed, { x = 760, y = 20, w = 250, h = 500 }, "last target")
end)

run("equidistant ultrawide slot centers choose the earlier slot", function()
	local first = make_target(311)
	local second = make_target(312)
	local workspace = "float-to-tile-tie"
	registered_layout.layout.recalculate(make_context({ first, second }, workspace))

	local tiled = make_target(313, true)
	local ctx = make_context({ first, second, tiled }, workspace)
	intents.record_placement_intent(tiled.window, {
		layout_name = "ultrawide_master",
		workspace_key = workspace,
		monitor_role = monitor_role.ultrawide,
		axis = "x",
		position = 335,
	})
	registered_layout.layout.recalculate(ctx)

	assert_box(tiled.placed, { x = 10, y = 20, w = 300, h = 500 }, "earlier target")
	assert_box(first.placed, { x = 310, y = 20, w = 400, h = 500 }, "first existing target")
	assert_box(second.placed, { x = 710, y = 20, w = 300, h = 500 }, "second existing target")
end)

run("same-scope drag geometry reorders active columns", function()
	local first = make_target(1, true)
	local second = make_target(2)
	local workspace = "same-scope-drag"

	registered_layout.layout.recalculate(make_context({ first, second }, workspace))
	set_geometry(first, 800)
	registered_layout.layout.recalculate(make_context({ first, second }, workspace))

	assert_box(second.placed, { x = 10, y = 20, w = 670, h = 500 }, "left target")
	assert_box(first.placed, { x = 680, y = 20, w = 330, h = 500 }, "dragged target")
end)

run("dragging active column left of layout moves it leftmost", function()
	local left = make_target(1)
	local right = make_target(2, true)
	local ctx = make_context({ left, right }, "drag-left-overshoot")
	registered_layout.layout.recalculate(ctx)

	cursor_position = { x = -400, y = 30 }
	registered_layout.layout.layout_msg(ctx, "place-at-cursor")
	cursor_position = nil
	registered_layout.layout.recalculate(ctx)

	assert_box(right.placed, { x = 10, y = 20, w = 670, h = 500 }, "dragged target")
	assert_box(left.placed, { x = 680, y = 20, w = 330, h = 500 }, "right target")
end)

run("dragging active column right of layout moves it rightmost", function()
	local left = make_target(1, true)
	local right = make_target(2)
	local ctx = make_context({ left, right }, "drag-right-overshoot")
	registered_layout.layout.recalculate(ctx)

	cursor_position = { x = 1200, y = 30 }
	registered_layout.layout.layout_msg(ctx, "place-at-cursor")
	cursor_position = nil
	registered_layout.layout.recalculate(ctx)

	assert_box(right.placed, { x = 10, y = 20, w = 670, h = 500 }, "left target")
	assert_box(left.placed, { x = 680, y = 20, w = 330, h = 500 }, "dragged target")
end)

run("title-bar drag reorders a tiled column at the release cursor", function()
	local left = set_geometry(make_target(1), 10, 670)
	local right = set_geometry(make_target(2, true), 680, 330)
	local ctx = make_context({ left, right }, "title-bar-drag")
	registered_layout.layout.recalculate(ctx)

	active_window = right.window
	right.window.floating = true
	registered_layout.layout.recalculate(make_context({ left }, "title-bar-drag"))

	right.window.floating = false
	set_geometry(right, 10, 330)
	cursor_position = { x = 100, y = 30 }
	registered_layout.layout.recalculate(ctx)
	cursor_position = nil

	assert_box(right.placed, { x = 10, y = 20, w = 670, h = 500 }, "dragged target")
	assert_box(left.placed, { x = 680, y = 20, w = 330, h = 500 }, "existing target")
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

run("portrait transfer intent inserts leftmost despite outside source x", function()
	local ultrawide_layout = registered_layout.layout
	local portrait_layout = require("layouts.portrait_rows")
	registered_layout.layout = ultrawide_layout

	local dragged = set_monitor(make_target(31, true), "HDMI-A-2")
	local source_other = set_monitor(make_target(32), "HDMI-A-2")
	portrait_layout.recalculate({ area = { x = -900, y = 0, w = 800, h = 1200 }, targets = { dragged, source_other } })

	local workspace = "cross-monitor-drag-left"
	dragged.window.workspace = { name = workspace }
	dragged.window.monitor.name = "DP-2"
	set_geometry(dragged, -900, 800)
	intents.record_transfer_intent(
		dragged.window,
		{ monitor_role = monitor_role.ultrawide, axis = "x", edge = "start" }
	)

	local left = make_target(33)
	local right = make_target(34)
	ultrawide_layout.recalculate(make_context({ left, right, dragged }, workspace))

	assert_box(dragged.placed, { x = 10, y = 20, w = 300, h = 500 }, "dragged target")
	assert_box(left.placed, { x = 310, y = 20, w = 400, h = 500 }, "left target")
	assert_box(right.placed, { x = 710, y = 20, w = 300, h = 500 }, "right target")
end)

run("cross-scope geometry without transfer intent keeps incoming order", function()
	local ultrawide_layout = registered_layout.layout
	local portrait_layout = require("layouts.portrait_rows")
	registered_layout.layout = ultrawide_layout

	local dragged = set_monitor(make_target(41, true), "HDMI-A-2")
	local source_other = set_monitor(make_target(42), "HDMI-A-2")
	portrait_layout.recalculate({ area = { x = 0, y = 0, w = 800, h = 1200 }, targets = { dragged, source_other } })

	local workspace = "cross-monitor-drag-overlap"
	dragged.window.workspace = { name = workspace }
	dragged.window.monitor.name = "DP-2"
	set_geometry(dragged, 100)

	local left = make_target(43)
	local right = make_target(44)
	ultrawide_layout.recalculate(make_context({ left, dragged, right }, workspace))

	assert_box(left.placed, { x = 10, y = 20, w = 300, h = 500 }, "left target")
	assert_box(dragged.placed, { x = 310, y = 20, w = 400, h = 500 }, "dragged target")
	assert_box(right.placed, { x = 710, y = 20, w = 300, h = 500 }, "right target")
end)

run("cross-scope drag left of ultrawide can move incoming window leftmost", function()
	local ultrawide_layout = registered_layout.layout
	local portrait_layout = require("layouts.portrait_rows")
	registered_layout.layout = ultrawide_layout

	local dragged = set_monitor(make_target(35, true), "HDMI-A-2")
	local source_other = set_monitor(make_target(36), "HDMI-A-2")
	portrait_layout.recalculate({ area = { x = -900, y = 0, w = 800, h = 1200 }, targets = { dragged, source_other } })

	local workspace = "cross-monitor-drag-leftmost"
	dragged.window.workspace = { name = workspace }
	dragged.window.monitor.name = "DP-2"
	set_geometry(dragged, -900)

	local left = make_target(37)
	local right = make_target(38)
	local ctx = make_context({ left, dragged, right }, workspace)
	ultrawide_layout.recalculate(ctx)
	cursor_position = { x = -900, y = 30 }
	ultrawide_layout.layout_msg(ctx, "place-at-cursor")
	cursor_position = nil
	ultrawide_layout.recalculate(ctx)

	assert_box(dragged.placed, { x = 10, y = 20, w = 300, h = 500 }, "dragged target")
	assert_box(left.placed, { x = 310, y = 20, w = 400, h = 500 }, "left target")
	assert_box(right.placed, { x = 710, y = 20, w = 300, h = 500 }, "right target")
end)

run("cross-scope drag right of ultrawide can move incoming window rightmost", function()
	local ultrawide_layout = registered_layout.layout
	local portrait_layout = require("layouts.portrait_rows")
	registered_layout.layout = ultrawide_layout

	local dragged = set_monitor(make_target(45, true), "HDMI-A-2")
	local source_other = set_monitor(make_target(46), "HDMI-A-2")
	portrait_layout.recalculate({ area = { x = 2000, y = 0, w = 800, h = 1200 }, targets = { dragged, source_other } })

	local workspace = "cross-monitor-drag-rightmost"
	dragged.window.workspace = { name = workspace }
	dragged.window.monitor.name = "DP-2"
	set_geometry(dragged, 2000)

	local left = make_target(47)
	local right = make_target(48)
	local ctx = make_context({ left, dragged, right }, workspace)
	ultrawide_layout.recalculate(ctx)
	cursor_position = { x = 2000, y = 30 }
	ultrawide_layout.layout_msg(ctx, "place-at-cursor")
	cursor_position = nil
	ultrawide_layout.recalculate(ctx)

	assert_box(left.placed, { x = 10, y = 20, w = 300, h = 500 }, "left target")
	assert_box(right.placed, { x = 310, y = 20, w = 400, h = 500 }, "center target")
	assert_box(dragged.placed, { x = 710, y = 20, w = 300, h = 500 }, "dragged target")
end)

run("drag geometry beats non-exact ultrawide transfer fallback", function()
	local dragged = set_geometry(make_target(39, true), 2000)
	dragged.window.address = nil
	local left = make_target(40)
	local right = make_target(41)
	intents.record_transfer_intent(
		{ address = "0xmissing" },
		{ monitor_role = monitor_role.ultrawide, axis = "x", edge = "start" }
	)

	local ctx = make_context({ left, dragged, right }, "ultrawide-drag-stale-fallback")
	registered_layout.layout.recalculate(ctx)
	cursor_position = { x = 2000, y = 30 }
	registered_layout.layout.layout_msg(ctx, "place-at-cursor")
	cursor_position = nil
	registered_layout.layout.recalculate(ctx)

	assert_box(left.placed, { x = 10, y = 20, w = 300, h = 500 }, "left target")
	assert_box(right.placed, { x = 310, y = 20, w = 400, h = 500 }, "center target")
	assert_box(dragged.placed, { x = 710, y = 20, w = 300, h = 500 }, "dragged target")
end)

run("portrait transfer intent inserts leftmost despite outside right source x", function()
	local ultrawide_layout = registered_layout.layout
	local portrait_layout = require("layouts.portrait_rows")
	registered_layout.layout = ultrawide_layout

	local dragged = set_monitor(make_target(51, true), "HDMI-A-2")
	local source_other = set_monitor(make_target(52), "HDMI-A-2")
	portrait_layout.recalculate({ area = { x = 2000, y = 0, w = 800, h = 1200 }, targets = { dragged, source_other } })

	local workspace = "cross-monitor-drag-right"
	dragged.window.workspace = { name = workspace }
	dragged.window.monitor.name = "DP-2"
	set_geometry(dragged, 2000)
	intents.record_transfer_intent(
		dragged.window,
		{ monitor_role = monitor_role.ultrawide, axis = "x", edge = "start" }
	)

	local left = make_target(53)
	local right = make_target(54)
	ultrawide_layout.recalculate(make_context({ left, dragged, right }, workspace))

	assert_box(dragged.placed, { x = 10, y = 20, w = 300, h = 500 }, "dragged target")
	assert_box(left.placed, { x = 310, y = 20, w = 400, h = 500 }, "left target")
	assert_box(right.placed, { x = 710, y = 20, w = 300, h = 500 }, "right target")
end)

run("transfer intent wins when target already arrives leftmost", function()
	local dragged = set_geometry(make_target(61, true), 100)
	local right = set_geometry(make_target(62), 800)
	local workspace = "transfer-already-leftmost"
	registered_layout.layout.recalculate(make_context({ dragged, right }, workspace))

	set_geometry(dragged, 900)
	intents.record_transfer_intent(
		dragged.window,
		{ monitor_role = monitor_role.ultrawide, axis = "x", edge = "start" }
	)
	registered_layout.layout.recalculate(make_context({ dragged, right }, workspace))

	assert_box(dragged.placed, { x = 10, y = 20, w = 670, h = 500 }, "dragged target")
	assert_box(right.placed, { x = 680, y = 20, w = 330, h = 500 }, "right target")
end)

run("portrait transfer exact id wins over existing active ultrawide target", function()
	local existing = set_geometry(make_target(91, true), 400)
	local dragged = set_geometry(make_target(92), -900, 800)
	local workspace = "transfer-exact-beats-existing-active"

	intents.record_transfer_intent(
		dragged.window,
		{ monitor_role = monitor_role.ultrawide, axis = "x", edge = "start" }
	)
	registered_layout.layout.recalculate(make_context({ existing, dragged }, workspace))

	assert_box(dragged.placed, { x = 10, y = 20, w = 670, h = 500 }, "dragged target")
	assert_box(existing.placed, { x = 680, y = 20, w = 330, h = 500 }, "existing target")
end)

run("new ultrawide transfer replaces stale exact intent", function()
	local stale = set_geometry(make_target(93), 100)
	local current = set_geometry(make_target(94, true), 800)
	local workspace = "transfer-replaces-stale-exact"

	intents.record_transfer_intent(stale.window, { monitor_role = monitor_role.ultrawide, axis = "x", edge = "start" })
	intents.record_transfer_intent(
		current.window,
		{ monitor_role = monitor_role.ultrawide, axis = "x", edge = "start" }
	)
	registered_layout.layout.recalculate(make_context({ stale, current }, workspace))

	assert_box(current.placed, { x = 10, y = 20, w = 670, h = 500 }, "current transfer target")
	assert_box(stale.placed, { x = 680, y = 20, w = 330, h = 500 }, "stale transfer target")
end)

run("portrait transfer survives destination recalculate before arrival", function()
	local workspace = "transfer-prearrival-recalculate"
	local left = set_geometry(make_target(101), 100)
	local active_existing = set_geometry(make_target(102, true), 800)

	registered_layout.layout.recalculate(make_context({ left, active_existing }, workspace))

	local dragged = set_geometry(make_target(103), -900, 800)
	intents.record_transfer_intent(
		dragged.window,
		{ monitor_role = monitor_role.ultrawide, axis = "x", edge = "start" }
	)

	registered_layout.layout.recalculate(make_context({ left, active_existing }, workspace))
	registered_layout.layout.recalculate(make_context({ left, active_existing, dragged }, workspace))

	assert_box(dragged.placed, { x = 10, y = 20, w = 300, h = 500 }, "dragged target")
	assert_box(left.placed, { x = 310, y = 20, w = 400, h = 500 }, "left target")
	assert_box(active_existing.placed, { x = 710, y = 20, w = 300, h = 500 }, "active existing target")
end)

run("portrait transfer intent survives active target id mismatch", function()
	local dragged = set_geometry(make_target(71, true), -900, 800)
	local left = make_target(72)
	local right = make_target(73)
	intents.record_transfer_intent(
		{ address = "0xmissing" },
		{ monitor_role = monitor_role.ultrawide, axis = "x", edge = "start" }
	)

	registered_layout.layout.recalculate(make_context({ left, right, dragged }, "transfer-id-mismatch"))

	assert_box(dragged.placed, { x = 10, y = 20, w = 300, h = 500 }, "dragged target")
	assert_box(left.placed, { x = 310, y = 20, w = 400, h = 500 }, "left target")
	assert_box(right.placed, { x = 710, y = 20, w = 300, h = 500 }, "right target")
end)

run("portrait transfer fallback uses single added target without active flag", function()
	local left = make_target(81)
	local right = make_target(82)
	local workspace = "transfer-added-no-active"
	registered_layout.layout.recalculate(make_context({ left, right }, workspace))

	local dragged = set_geometry(make_target(83), -900, 800)
	intents.record_transfer_intent(
		{ address = "0xmissing" },
		{ monitor_role = monitor_role.ultrawide, axis = "x", edge = "start" }
	)
	registered_layout.layout.recalculate(make_context({ left, right, dragged }, workspace))

	assert_box(dragged.placed, { x = 10, y = 20, w = 300, h = 500 }, "dragged target")
	assert_box(left.placed, { x = 310, y = 20, w = 400, h = 500 }, "left target")
	assert_box(right.placed, { x = 710, y = 20, w = 300, h = 500 }, "right target")
end)

run("swap and resize no-op without active target", function()
	local first = make_target(1)
	local second = make_target(2)
	local ctx = make_context({ first, second }, "no-active-mutate")

	registered_layout.layout.layout_msg(ctx, "swapnext")
	registered_layout.layout.layout_msg(ctx, "resize-x 50")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 670, h = 500 }, "left target")
	assert_box(second.placed, { x = 680, y = 20, w = 330, h = 500 }, "right target")
end)

run("duplicate target identity falls back to source order", function()
	local first = set_geometry(make_target(1, true), 800)
	local second = set_geometry(make_target(2), 100)
	second.window.address = first.window.address
	second.window.stable_id = first.window.stable_id

	registered_layout.layout.recalculate(make_context({ first, second }, "duplicate-id"))

	assert_box(first.placed, { x = 10, y = 20, w = 670, h = 500 }, "first target")
	assert_box(second.placed, { x = 680, y = 20, w = 330, h = 500 }, "second target")
end)

run("missing address uses stable identity for drag order", function()
	local first = set_geometry(make_target(1, true), 800)
	local second = set_geometry(make_target(2), 100)
	first.window.address = nil

	registered_layout.layout.recalculate(make_context({ first, second }, "missing-address-stable-id"))

	assert_box(second.placed, { x = 10, y = 20, w = 670, h = 500 }, "second target")
	assert_box(first.placed, { x = 680, y = 20, w = 330, h = 500 }, "first target")
end)

run("missing target identity falls back to source order", function()
	local first = set_geometry(make_target(1, true), 800)
	local second = set_geometry(make_target(2), 100)
	first.window.address = nil
	first.window.stable_id = nil

	registered_layout.layout.recalculate(make_context({ first, second }, "missing-id"))

	assert_box(first.placed, { x = 10, y = 20, w = 670, h = 500 }, "first target")
	assert_box(second.placed, { x = 680, y = 20, w = 330, h = 500 }, "second target")
end)

run("empty order initializes from current geometry after reload", function()
	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")

	local first = set_geometry(make_target(1), 800)
	local second = set_geometry(make_target(2, true), 100)
	registered_layout.layout.recalculate(make_context({ first, second }, "reload-order-geometry"))

	assert_box(second.placed, { x = 10, y = 20, w = 670, h = 500 }, "left target")
	assert_box(first.placed, { x = 680, y = 20, w = 330, h = 500 }, "right target")
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

run("absolute resize targets the captured window identity", function()
	local first = make_target(1, true)
	local second = make_target(2)
	local third = make_target(3)
	local ctx = make_context({ first, second, third })

	registered_layout.layout.layout_msg(ctx, "resize-x-at address:0x2 right 800")
	registered_layout.layout.recalculate(ctx)

	assert_box(first.placed, { x = 10, y = 20, w = 300, h = 500 }, "left target")
	assert_box(second.placed, { x = 310, y = 20, w = 490, h = 500 }, "captured target")
	assert_box(third.placed, { x = 800, y = 20, w = 210, h = 500 }, "right target")
end)

run("absolute resize persists once when the drag stops", function()
	_G.__ULTRAWIDE_MASTER_DISABLE_STATE = nil
	_G.__ULTRAWIDE_MASTER_STATE_FILE = os.tmpname()
	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")

	local first = set_geometry(make_target(1, true), 100)
	local second = set_geometry(make_target(2), 800)
	local ctx = make_context({ first, second }, "deferred-resize")
	registered_layout.layout.recalculate(ctx)

	local writes = count_state_writes(_G.__ULTRAWIDE_MASTER_STATE_FILE, function()
		registered_layout.layout.layout_msg(ctx, "resize-x-at right 760")
	end)
	assert_equal(writes, 0, "writes before drag stop")

	writes = count_state_writes(_G.__ULTRAWIDE_MASTER_STATE_FILE, function()
		registered_layout.layout.layout_msg(ctx, "save-resize")
	end)
	assert_equal(writes, 1, "writes after drag stop")

	writes = count_state_writes(_G.__ULTRAWIDE_MASTER_STATE_FILE, function()
		registered_layout.layout.layout_msg(ctx, "resize-x-at right 760")
		registered_layout.layout.layout_msg(ctx, "save-resize")
	end)
	assert_equal(writes, 0, "writes for unchanged resize")

	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")
	local reloaded_first = set_geometry(make_target(1, true), 100)
	local reloaded_second = set_geometry(make_target(2), 800)
	registered_layout.layout.recalculate(make_context({ reloaded_first, reloaded_second }, "deferred-resize"))

	assert_box(reloaded_first.placed, { x = 10, y = 20, w = 750, h = 500 }, "reloaded left target")
	assert_box(reloaded_second.placed, { x = 760, y = 20, w = 250, h = 500 }, "reloaded right target")
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

run("portrait fallback persists vertical resize when the drag stops", function()
	_G.__ULTRAWIDE_MASTER_DISABLE_STATE = nil
	_G.__ULTRAWIDE_MASTER_STATE_FILE = os.tmpname()
	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")

	local top = set_monitor(make_target(1, true), "HDMI-A-2")
	local bottom = set_monitor(make_target(2), "HDMI-A-2")
	local ctx = make_context({ top, bottom }, "deferred-vertical-resize")
	registered_layout.layout.recalculate(ctx)

	local writes = count_state_writes(_G.__ULTRAWIDE_MASTER_STATE_FILE, function()
		registered_layout.layout.layout_msg(ctx, "resize-y-at down 220")
	end)
	assert_equal(writes, 0, "writes before drag stop")

	writes = count_state_writes(_G.__ULTRAWIDE_MASTER_STATE_FILE, function()
		registered_layout.layout.layout_msg(ctx, "save-resize")
	end)
	assert_equal(writes, 1, "writes after drag stop")
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

run("manual column order survives layout module reload", function()
	_G.__ULTRAWIDE_MASTER_DISABLE_STATE = nil
	_G.__ULTRAWIDE_MASTER_STATE_FILE = os.tmpname()
	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")

	local workspace = "persisted-order-test"
	local first = set_geometry(make_target(1, true), 100)
	local second = set_geometry(make_target(2), 800)
	local ctx = make_context({ first, second }, workspace)

	registered_layout.layout.recalculate(ctx)
	registered_layout.layout.layout_msg(ctx, "swapnext")
	registered_layout.layout.recalculate(ctx)
	assert_box(second.placed, { x = 10, y = 20, w = 670, h = 500 }, "swapped left target")

	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")

	local reloaded_first = set_geometry(make_target(1, true), 100)
	local reloaded_second = set_geometry(make_target(2), 800)
	local reloaded_ctx = make_context({ reloaded_first, reloaded_second }, workspace)
	registered_layout.layout.recalculate(reloaded_ctx)

	assert_box(reloaded_second.placed, { x = 10, y = 20, w = 670, h = 500 }, "reloaded left target")
	assert_box(reloaded_first.placed, { x = 680, y = 20, w = 330, h = 500 }, "reloaded right target")
	registered_layout.layout.layout_msg(reloaded_ctx, "reset")
	os.remove(_G.__ULTRAWIDE_MASTER_STATE_FILE)
	_G.__ULTRAWIDE_MASTER_STATE_FILE = nil
	_G.__ULTRAWIDE_MASTER_DISABLE_STATE = true
end)

run("manual column order survives reload with numeric workspace id", function()
	_G.__ULTRAWIDE_MASTER_DISABLE_STATE = nil
	_G.__ULTRAWIDE_MASTER_STATE_FILE = os.tmpname()
	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")

	local workspace = { id = 202, name = "numeric-workspace-test" }
	local first = set_geometry(make_target(1, true), 100)
	local second = set_geometry(make_target(2), 800)
	local ctx = make_context_with_workspace({ first, second }, workspace)

	registered_layout.layout.recalculate(ctx)
	registered_layout.layout.layout_msg(ctx, "swapnext")
	registered_layout.layout.recalculate(ctx)
	assert_box(second.placed, { x = 10, y = 20, w = 670, h = 500 }, "swapped left target")

	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")

	local reloaded_first = set_geometry(make_target(1, true), 100)
	local reloaded_second = set_geometry(make_target(2), 800)
	local reloaded_ctx = make_context_with_workspace({ reloaded_first, reloaded_second }, workspace)
	registered_layout.layout.recalculate(reloaded_ctx)

	assert_box(reloaded_second.placed, { x = 10, y = 20, w = 670, h = 500 }, "reloaded left target")
	assert_box(reloaded_first.placed, { x = 680, y = 20, w = 330, h = 500 }, "reloaded right target")
	registered_layout.layout.layout_msg(reloaded_ctx, "reset")
	os.remove(_G.__ULTRAWIDE_MASTER_STATE_FILE)
	_G.__ULTRAWIDE_MASTER_STATE_FILE = nil
	_G.__ULTRAWIDE_MASTER_DISABLE_STATE = true
end)

run("manual column order uses stable ids for same app windows", function()
	_G.__ULTRAWIDE_MASTER_DISABLE_STATE = nil
	_G.__ULTRAWIDE_MASTER_STATE_FILE = os.tmpname()
	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")

	local workspace = { id = 303, name = "same-app-workspace" }
	local first = set_geometry(make_target(1, true), 100)
	local second = set_geometry(make_target(2), 800)
	first.window.class = "org.wezfurlong.wezterm"
	second.window.class = "org.wezfurlong.wezterm"
	first.window.title = "wezterm"
	second.window.title = "wezterm"
	local ctx = make_context_with_workspace({ first, second }, workspace)

	registered_layout.layout.recalculate(ctx)
	registered_layout.layout.layout_msg(ctx, "swapnext")
	registered_layout.layout.recalculate(ctx)

	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")

	local reloaded_first = set_geometry(make_target(1, true), 100)
	local reloaded_second = set_geometry(make_target(2), 800)
	reloaded_first.window.class = "org.wezfurlong.wezterm"
	reloaded_second.window.class = "org.wezfurlong.wezterm"
	reloaded_first.window.title = "wezterm"
	reloaded_second.window.title = "wezterm"
	local reloaded_ctx = make_context_with_workspace({ reloaded_first, reloaded_second }, workspace)
	registered_layout.layout.recalculate(reloaded_ctx)

	assert_box(reloaded_second.placed, { x = 10, y = 20, w = 670, h = 500 }, "reloaded left target")
	assert_box(reloaded_first.placed, { x = 680, y = 20, w = 330, h = 500 }, "reloaded right target")
	registered_layout.layout.layout_msg(reloaded_ctx, "reset")
	os.remove(_G.__ULTRAWIDE_MASTER_STATE_FILE)
	_G.__ULTRAWIDE_MASTER_STATE_FILE = nil
	_G.__ULTRAWIDE_MASTER_DISABLE_STATE = true
end)

run("saved column order survives partial reload target list", function()
	_G.__ULTRAWIDE_MASTER_DISABLE_STATE = nil
	_G.__ULTRAWIDE_MASTER_STATE_FILE = os.tmpname()
	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")

	local workspace = { id = 304, name = "partial-reload-workspace" }
	local first = set_geometry(make_target(1), 100)
	local second = set_geometry(make_target(2), 400)
	local third = set_geometry(make_target(3), 800)
	local ctx = make_context_with_workspace({ first, second, third }, workspace)
	registered_layout.layout.recalculate(ctx)

	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")

	local partial_first = set_geometry(make_target(1), 100)
	local partial_third = set_geometry(make_target(3), 800)
	registered_layout.layout.recalculate(make_context_with_workspace({ partial_first, partial_third }, workspace))

	local reloaded_first = set_geometry(make_target(1), 100)
	local reloaded_second = set_geometry(make_target(2), 400)
	local reloaded_third = set_geometry(make_target(3), 800)
	local reloaded_ctx = make_context_with_workspace({ reloaded_first, reloaded_third, reloaded_second }, workspace)
	registered_layout.layout.recalculate(reloaded_ctx)

	assert_box(reloaded_first.placed, { x = 10, y = 20, w = 300, h = 500 }, "reloaded left target")
	assert_box(reloaded_second.placed, { x = 310, y = 20, w = 400, h = 500 }, "reloaded middle target")
	assert_box(reloaded_third.placed, { x = 710, y = 20, w = 300, h = 500 }, "reloaded right target")
	registered_layout.layout.layout_msg(reloaded_ctx, "reset")
	os.remove(_G.__ULTRAWIDE_MASTER_STATE_FILE)
	_G.__ULTRAWIDE_MASTER_STATE_FILE = nil
	_G.__ULTRAWIDE_MASTER_DISABLE_STATE = true
end)

run("prune-order removes missing column identities when invoked", function()
	_G.__ULTRAWIDE_MASTER_DISABLE_STATE = nil
	_G.__ULTRAWIDE_MASTER_STATE_FILE = os.tmpname()
	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")

	local workspace = "prune-column-order"
	local first = make_target(1, true)
	local second = make_target(2)
	local third = make_target(3)
	registered_layout.layout.recalculate(make_context({ first, second, third }, workspace))
	registered_layout.layout.layout_msg(make_context({ first }, workspace), "prune-order")
	local saved_orders = {}
	persistent_state.load(_G.__ULTRAWIDE_MASTER_STATE_FILE, {}, saved_orders)
	assert_equal(#saved_orders[workspace], 1, "saved order size")

	package.loaded["layouts.ultrawide_master"] = nil
	require("layouts.ultrawide_master")

	local reloaded_first = make_target(1, true)
	local reloaded_second = make_target(2)
	local reloaded_third = make_target(3)
	registered_layout.layout.recalculate(make_context({ reloaded_third, reloaded_second, reloaded_first }, workspace))

	assert_box(reloaded_first.placed, { x = 10, y = 20, w = 300, h = 500 }, "retained left target")
	assert_box(reloaded_third.placed, { x = 310, y = 20, w = 400, h = 500 }, "new middle target")
	assert_box(reloaded_second.placed, { x = 710, y = 20, w = 300, h = 500 }, "new right target")
end)
