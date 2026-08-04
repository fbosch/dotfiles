local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/custom_layout_drag_resize_protocol_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local protocol = require("runtime.windows.daemons.custom-layout-drag-resize.control-protocol")

describe("custom layout drag resize control protocol", function()
	it("rejects a delayed press after its release", function()
		local release = assert(protocol.parse("stop 2"))
		local delayed_press = assert(protocol.parse("start 1"))

		assert.is_true(protocol.is_newer(release, 0))
		assert.is_false(protocol.is_newer(delayed_press, release.sequence))
	end)

	it("keeps event ordering across config reloads", function()
		local path = os.tmpname()
		os.remove(path)

		assert.are.equal(1, protocol.next_sequence(path))
		assert.are.equal(2, protocol.next_sequence(path))
		os.remove(path)
	end)

	it("accepts health and shutdown commands without a sequence", function()
		assert.are.equal("ping", assert(protocol.parse("ping")).action)
		assert.are.equal("quit", assert(protocol.parse("quit")).action)
	end)
end)
