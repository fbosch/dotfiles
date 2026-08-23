local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/ags_ipc_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local ags_ipc = require("runtime.lib.ags-ipc")

local function assert_equal(actual, expected, message)
	if actual ~= expected then
		error(string.format("%s: expected %s, got %s", message, tostring(expected), tostring(actual)), 2)
	end
end

it("parses a quoted busctl string", function()
	assert_equal(ags_ipc.parse_busctl_string([[s "hello"]]), "hello", "quoted string")
end)

it("parses an unquoted busctl string", function()
	assert_equal(ags_ipc.parse_busctl_string("s plain"), "plain", "unquoted string")
end)

it("strips trailing whitespace", function()
	assert_equal(ags_ipc.parse_busctl_string([[s "value"  ]]), "value", "trailing whitespace")
end)

it("unescapes quotes inside a quoted busctl string", function()
	assert_equal(ags_ipc.parse_busctl_string([[s "say \"hi\""]]), [[say "hi"]], "escaped quote")
end)

it("unescapes backslashes inside a quoted busctl string", function()
	assert_equal(ags_ipc.parse_busctl_string([[s "a\\b"]]), [[a\b]], "escaped backslash")
end)
