local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/drop_intents_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local module_names = {
	"layouts.shared.order_state",
	"layouts.shared.intents",
	"layouts.shared.ordered_axis",
	"lib.monitor_role",
	"lib.window.state",
	"lib.window_tags",
	"lib.window.custom_layout",
}

describe("targeted drop intent lifecycle", function()
	local saved_modules
	local saved_hl
	local timers
	local intents
	local order_state
	local ordered_axis
	local custom_layout
	local workspace
	local target

	local function request(position)
		assert.is_true(custom_layout.request_drop(target.window, workspace, position or 900, 280))
	end

	local function consume(opts)
		opts = opts or {}
		return intents.consume_drop_intent(
			target,
			opts.layout or "ultrawide_master",
			opts.key or "7",
			opts.role or "ultrawide",
			opts.axis or "x"
		)
	end

	local function recalculate(targets, key)
		local state = order_state.new()
		return ordered_axis.recalculate_ordered({
			state = state,
			key = key or "7",
			targets = targets,
			layout_name = "ultrawide_master",
			role = "ultrawide",
			axis = "x",
			ratios = { 0.67, 0.33 },
			start = 10,
			span = 1000,
			active_index = order_state.active_index,
			save_state = function() end,
		})
	end

	before_each(function()
		saved_hl = _G.hl
		saved_modules = {}
		for _, name in ipairs(module_names) do
			saved_modules[name] = package.loaded[name]
			package.loaded[name] = nil
		end
		timers = {}
		_G.hl = {
			dispatch = function()
				error("drop must not dispatch")
			end,
			dsp = { window = {
				float = function()
					return function() end
				end,
			} },
			timer = function(callback, opts)
				assert.same({ timeout = 2000, type = "oneshot" }, opts)
				timers[#timers + 1] = callback
			end,
		}
		order_state = require("layouts.shared.order_state")
		intents = require("layouts.shared.intents")
		ordered_axis = require("layouts.shared.ordered_axis")
		custom_layout = require("lib.window.custom_layout")
		workspace = { id = 7, tiled_layout = "lua:ultrawide_master", monitor = { name = "DP-2" } }
		target = { window = { address = "0xdragged", floating = false, workspace = workspace } }
	end)

	after_each(function()
		_G.hl = saved_hl
		for _, name in ipairs(module_names) do
			package.loaded[name] = saved_modules[name]
		end
	end)

	it("skips drop pruning and consumption when no drops are pending", function()
		assert.is_false(intents.has_drop_intents())
		intents.prune_drop_intents = function()
			error("empty drop map must not prune targets")
		end
		intents.consume_drop_intent = function()
			error("empty drop map must not scan targets")
		end
		local second = { window = { address = "0xsecond", workspace = workspace } }
		assert.same({ target, second }, recalculate({ target, second }))
	end)

	it("tracks pending drops through consumption, clearing, and expiry", function()
		assert.is_false(intents.has_drop_intents())
		request()
		assert.is_true(intents.has_drop_intents())
		consume()
		assert.is_false(intents.has_drop_intents())
		request()
		intents.clear_drop_intent(target.window)
		assert.is_false(intents.has_drop_intents())
		request()
		timers[#timers]()
		assert.is_false(intents.has_drop_intents())
	end)

	it("discards a moved target's drop even if its destination has no pending drop", function()
		request()
		target.window.workspace = { id = 8 }
		local second = { window = { address = "0xsecond", workspace = target.window.workspace } }
		assert.same({ target, second }, recalculate({ target, second }, "8"))
		assert.is_false(intents.has_drop_intents())
	end)

	it("consumes a single-window drop before a second window arrives", function()
		request()
		ordered_axis.remember_single(
			order_state.new(),
			"7",
			{ target },
			"ultrawide_master",
			"ultrawide",
			"x",
			510,
			order_state.active_index
		)
		assert.is_nil(consume())
		local second = { window = { address = "0xsecond", workspace = workspace } }
		assert.same({ target, second }, recalculate({ target, second }))
	end)

	it("consumes a no-op drop once", function()
		request(345)
		local second = { window = { address = "0xsecond", workspace = workspace } }
		assert.same({ target, second }, recalculate({ target, second }))
		assert.is_nil(consume())
	end)

	for field, value in pairs({ layout = "portrait_rows", key = "8", role = "portrait", axis = "y" }) do
		it("discards a drop rejected by " .. field, function()
			request()
			assert.is_nil(consume({ [field] = value }))
			assert.is_nil(consume())
		end)
	end

	it("discards a drop if its target becomes floating", function()
		request()
		target.window.floating = true
		assert.is_nil(consume())
		target.window.floating = false
		assert.is_nil(consume())
	end)

	it("discards a disappeared target at the next ordered recalculation", function()
		request()
		local first = { window = { address = "0xfirst", workspace = workspace } }
		local second = { window = { address = "0xsecond", workspace = workspace } }
		recalculate({ first, second })
		assert.is_nil(consume())
	end)

	it("discards a disappeared target when only one tiled window remains", function()
		request()
		local remaining = { window = { address = "0xremaining", workspace = workspace } }
		ordered_axis.remember_single(
			order_state.new(),
			"7",
			{ remaining },
			"ultrawide_master",
			"ultrawide",
			"x",
			510,
			order_state.active_index
		)
		assert.is_nil(consume())
	end)

	it("does not prune a destination drop during another workspace's recalculation", function()
		request()
		recalculate({ { window = { address = "0xother" } } }, "8")
		assert.are.equal(900, consume().position)
	end)

	for _, reason in ipairs({ "floating", "workspace", "role", "layout", "coordinates" }) do
		it("clears an earlier request when a new drop is rejected: " .. reason, function()
			request()
			local x = 900
			if reason == "floating" then
				target.window.floating = true
			end
			if reason == "workspace" then
				target.window.workspace = { id = 8 }
			end
			if reason == "role" then
				workspace.monitor.name = "HDMI-A-2"
			end
			if reason == "layout" then
				workspace.tiled_layout = "dwindle"
			end
			if reason == "coordinates" then
				x = nil
			end
			assert.is_false(custom_layout.request_drop(target.window, workspace, x, 280))
			assert.is_nil(consume())
		end)
	end

	it("uses destination role and y coordinate for portrait placement", function()
		workspace.tiled_layout = "lua:portrait_rows"
		workspace.monitor.name = "HDMI-A-2"
		request()
		local intent = consume({ layout = "portrait_rows", role = "portrait", axis = "y" })
		assert.are.equal(280, intent.position)
		assert.is_nil(consume({ layout = "portrait_rows", role = "portrait", axis = "y" }))
	end)

	it("expires an unconsumed drop without clearing its replacement", function()
		request(100)
		request(900)
		timers[1]()
		assert.are.equal(900, consume().position)
		request()
		timers[3]()
		assert.is_nil(consume())
	end)
end)
