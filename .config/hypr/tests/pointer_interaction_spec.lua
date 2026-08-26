local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/pointer_interaction_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local pointer = require("lib.window.pointer")

local function setup(opts)
	opts = opts or {}
	local calls = {}
	local resize_target
	local function record(value)
		calls[#calls + 1] = value
	end

	local custom_layout = {
		start_custom_layout_resize = function()
			record("custom.start")
			return opts.custom_resize == true
		end,
		stop_custom_layout_resize = function()
			record("custom.stop")
		end,
		resize_keep_aspect_ratio = function()
			record("custom.aspect.start")
		end,
		reset_keep_aspect_ratio = function()
			record("custom.aspect.reset")
		end,
	}
	local router = pointer.new({
		interaction = {
			start_drag = function()
				record("interaction.start")
				return opts.drag_started == true
			end,
			finish_drag = function(layout)
				assert.equal(custom_layout, layout)
				record("interaction.finish")
			end,
		},
		picture_in_picture = {
			start_resize = function(target, keep_aspect_ratio)
				resize_target = target
				record("pip.start:" .. tostring(keep_aspect_ratio))
				return opts.pip_resize == true
			end,
			finish_resize = function(keep_aspect_ratio)
				record("pip.finish:" .. tostring(keep_aspect_ratio))
			end,
		},
		custom_layout = custom_layout,
		state = {
			at_cursor = function()
				return opts.cursor_target
			end,
			active = function()
				return opts.active_target
			end,
		},
		dispatch = function(value)
			record("dispatch:" .. value)
		end,
		window = {
			drag = function()
				return "drag"
			end,
			resize = function()
				return "resize"
			end,
		},
	})

	return router, calls, function()
		return resize_target
	end
end

describe("pointer interaction router", function()
	it("does not request release when drag eligibility rejects the press", function()
		local router, calls = setup()
		assert.is_nil(router.start_drag())
		assert.same({ "interaction.start" }, calls)
	end)

	it("lets the interaction start the drag and dispatches release before finishing", function()
		local router, calls = setup({ drag_started = true })
		local release = router.start_drag()
		assert.same({ "interaction.start" }, calls)

		release()
		assert.same({ "interaction.start", "dispatch:drag", "interaction.finish" }, calls)
	end)

	it("routes resize to PiP before other owners", function()
		local cursor_target = { address = "0x1" }
		local active_target = { address = "0x2" }
		local router, calls, resized_target = setup({
			pip_resize = true,
			custom_resize = true,
			cursor_target = cursor_target,
			active_target = active_target,
		})
		local release = router.start_resize(false)
		assert.same({ "pip.start:false" }, calls)
		assert.equal(cursor_target, resized_target())

		release()
		assert.same({ "pip.start:false", "dispatch:resize", "pip.finish:false" }, calls)
	end)

	it("routes non-PiP resize to the custom-layout owner", function()
		local router, calls = setup({ custom_resize = true })
		local release = router.start_resize(false)
		assert.same({ "pip.start:false", "custom.start" }, calls)

		release()
		assert.same({ "pip.start:false", "custom.start", "custom.stop" }, calls)
	end)

	it("falls back to native resize for unclaimed presses", function()
		local router, calls = setup()
		local release = router.start_resize(false)
		assert.same({ "pip.start:false", "custom.start", "dispatch:resize" }, calls)

		release()
		assert.same({ "pip.start:false", "custom.start", "dispatch:resize", "dispatch:resize" }, calls)
	end)

	it("preserves PiP aspect-ratio resize ordering", function()
		local router, calls = setup({ pip_resize = true })
		local release = router.start_resize(true)
		assert.same({ "pip.start:true" }, calls)

		release()
		assert.same({ "pip.start:true", "dispatch:resize", "pip.finish:true" }, calls)
	end)

	it("uses native aspect-ratio resize for non-PiP windows", function()
		local router, calls = setup({ custom_resize = true })
		local release = router.start_resize(true)
		assert.same({ "pip.start:true", "custom.aspect.start" }, calls)

		release()
		assert.same({ "pip.start:true", "custom.aspect.start", "dispatch:resize", "custom.aspect.reset" }, calls)
	end)
end)
