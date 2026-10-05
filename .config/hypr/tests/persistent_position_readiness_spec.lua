local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/persistent_position_readiness_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local readiness = require("plugins.persistent_position_readiness")

describe("native position readiness", function()
	local path
	before_each(function()
		path = os.tmpname()
		os.remove(path)
	end)
	after_each(function()
		os.remove(path)
		os.remove(path .. ".tmp")
	end)

	it("publishes the exact configured selector identities without a daemon module refresh", function()
		readiness.publish(path, { { matcher = "match:class", pattern = "^nemo$" } })
		assert.is_true(readiness.read(path)["match:class\0^nemo$"])
		readiness.publish(path, { { matcher = "match:class", pattern = "^Bitwarden$" } })
		local latest = readiness.read(path)
		assert.is_nil(latest["match:class\0^nemo$"])
		assert.is_true(latest["match:class\0^Bitwarden$"])
	end)

	it("marks full native ownership separately from the position-only handoff", function()
		local selectors = { { matcher = "match:class", pattern = "^nemo$" } }
		readiness.publish(path, selectors)
		assert.is_false(readiness.native_state(path))
		readiness.publish(path, selectors, true)
		assert.is_true(readiness.native_state(path))
		assert.is_true(readiness.read(path)["match:class\0^nemo$"])
	end)

	it("fails closed for absent, malformed, or oversized readiness", function()
		assert.is_nil(readiness.read(path))
		local file = assert(io.open(path, "w"))
		assert(file:write('{"version":1,"selectors":[]}'))
		assert(file:close())
		assert.is_nil(readiness.read(path))
		file = assert(io.open(path, "w"))
		assert(file:write(string.rep("x", 16385)))
		assert(file:close())
		assert.is_nil(readiness.read(path))
	end)
end)
