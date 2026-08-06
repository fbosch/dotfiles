local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/window_tags_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local window_tags = require("lib.window_tags")

describe("window tags", function()
	it("recognizes static and dynamic non-resizable tags", function()
		assert.is_true(window_tags.has({ "non-resizable" }, window_tags.non_resizable))
		assert.is_true(window_tags.has({ "non-resizable*" }, window_tags.non_resizable))
	end)

	it("does not match unrelated or missing tags", function()
		assert.is_false(window_tags.has({ "pip-top-right" }, window_tags.non_resizable))
		assert.is_false(window_tags.has(nil, window_tags.non_resizable))
	end)
end)
