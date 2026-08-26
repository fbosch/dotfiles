local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/pointer_interaction_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local pointer = require("lib.window.pointer")

local function window(address, opts)
	opts = opts or {}
	return {
		address = address,
		stable_id = opts.stable_id,
		content_type = opts.content_type or "none",
		fullscreen = opts.fullscreen or 0,
	}
end

local function setup(opts)
	opts = opts or {}
	local calls = {}
	local current_windows = opts.windows or {}
	local function record(value)
		calls[#calls + 1] = value
	end
	local function address(target)
		return target and target.address or "nil"
	end

	local router = pointer.new({
		picture_in_picture = {
			start_drag = function(target)
				record("pip.drag.start:" .. address(target))
				return opts.pip_drag == true
			end,
			finish_drag = function(target)
				record("pip.drag.finish:" .. address(target))
			end,
			start_resize = function(target)
				record("pip.resize.start:" .. address(target))
				return opts.pip_resize == true
			end,
			finish_resize = function(target)
				record("pip.resize.finish:" .. address(target))
			end,
		},
		custom_layout = {
			place_custom_layout_at_cursor = function(target)
				record("custom.place:" .. address(target))
			end,
			start_custom_layout_resize = function(target)
				record("custom.resize.start:" .. address(target))
				return opts.custom_resize == true
			end,
			stop_custom_layout_resize = function()
				record("custom.resize.stop")
			end,
		},
		state = {
			at_cursor = function()
				return opts.cursor_target
			end,
			active = function()
				return opts.active_target
			end,
			is_game = function(target)
				return target ~= nil and target.content_type == "game"
			end,
		},
		get_windows = function()
			return current_windows
		end,
		dispatch = function(value)
			record("dispatch:" .. value)
		end,
		window = {
			drag = function()
				return "drag"
			end,
			resize = function(args)
				return args and args.keep_aspect_ratio and "resize:aspect" or "resize"
			end,
		},
	})

	return router, calls, function(windows)
		current_windows = windows
	end
end

describe("pointer interaction router", function()
	it("rejects targets without stable identity and fullscreen games", function()
		local unidentified = { content_type = "none", fullscreen = 0 }
		local router, calls = setup({ cursor_target = unidentified })
		assert.is_nil(router.start_drag())
		assert.same({}, calls)

		local game = window("0xgame", { content_type = "game", fullscreen = 1 })
		router, calls = setup({ cursor_target = game })
		assert.is_nil(router.start_drag())
		assert.same({}, calls)
	end)

	it("owns native drag dispatch and releases the cursor target", function()
		local target = window("0xcursor")
		local active = window("0xgame", { content_type = "game", fullscreen = 1 })
		local current = window("0xcursor")
		local router, calls = setup({ cursor_target = target, active_target = active, windows = { current } })

		local release = router.start_drag()
		assert.same({ "pip.drag.start:0xcursor", "dispatch:drag" }, calls)

		release()
		assert.same({
			"pip.drag.start:0xcursor",
			"dispatch:drag",
			"dispatch:drag",
			"custom.place:0xcursor",
		}, calls)
	end)

	it("revalidates a PiP drag by stable identity instead of reused address", function()
		local target = window("0x1", { stable_id = 7 })
		local router, calls, set_windows = setup({ cursor_target = target, pip_drag = true })
		local release = router.start_drag()

		set_windows({ window("0x1", { stable_id = 8 }) })
		release()
		assert.same({
			"pip.drag.start:0x1",
			"dispatch:drag",
			"dispatch:drag",
			"pip.drag.finish:nil",
		}, calls)
	end)

	it("passes the current PiP record to release without requiring focus", function()
		local pressed = window("0x1")
		local current = window("0x1")
		local router, calls = setup({ cursor_target = pressed, windows = { current }, pip_drag = true })
		local release = router.start_drag()

		release()
		assert.equal("pip.drag.finish:0x1", calls[#calls])
	end)

	it("routes PiP aspect resize through one native lifecycle", function()
		local target = window("0x1")
		local current = window("0x1")
		local router, calls = setup({ cursor_target = target, windows = { current }, pip_resize = true })
		local release = router.start_resize(true)

		assert.same({ "pip.resize.start:0x1", "dispatch:resize:aspect" }, calls)
		release()
		assert.same({
			"pip.resize.start:0x1",
			"dispatch:resize:aspect",
			"dispatch:resize:aspect",
			"pip.resize.finish:0x1",
		}, calls)
	end)

	it("routes custom-layout resize without a second native owner", function()
		local target = window("0x1")
		local router, calls = setup({ cursor_target = target, custom_resize = true })
		local release = router.start_resize(false)

		assert.same({ "pip.resize.start:0x1", "custom.resize.start:0x1" }, calls)
		release()
		assert.same({ "pip.resize.start:0x1", "custom.resize.start:0x1", "custom.resize.stop" }, calls)
	end)

	it("uses native aspect resize before the custom-layout adapter", function()
		local target = window("0x1")
		local router, calls = setup({ cursor_target = target, custom_resize = true })
		local release = router.start_resize(true)

		assert.same({ "pip.resize.start:0x1", "dispatch:resize:aspect" }, calls)
		release()
		assert.same({
			"pip.resize.start:0x1",
			"dispatch:resize:aspect",
			"dispatch:resize:aspect",
		}, calls)
	end)

	it("falls back to one native resize lifecycle", function()
		local target = window("0x1")
		local router, calls = setup({ cursor_target = target })
		local release = router.start_resize(false)

		assert.same({ "pip.resize.start:0x1", "custom.resize.start:0x1", "dispatch:resize" }, calls)
		release()
		assert.equal("dispatch:resize", calls[#calls])
	end)
end)
