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

local function load_with_command(fake_command)
	local cached = package.loaded["runtime.lib.ags-ipc"]
	local cached_command = package.loaded["lib.command"]
	package.loaded["runtime.lib.ags-ipc"] = nil
	package.loaded["lib.command"] = fake_command
	local module = require("runtime.lib.ags-ipc")
	package.loaded["runtime.lib.ags-ipc"] = cached
	package.loaded["lib.command"] = cached_command
	return module
end

it("applies the requested timeout to busctl transport", function()
	local commands = {}
	local module = load_with_command({
		arg = function(value)
			return "[" .. tostring(value) .. "]"
		end,
		ok = function()
			return true
		end,
		output = function(command_line)
			commands[#commands + 1] = command_line
			return 's "reply"'
		end,
	})

	assert_equal(module.request("component", "payload", { timeout = 1.25 }), "reply", "busctl response")
	assert(commands[1]:match("%-%-timeout=%[1%.25%]"), "busctl uses opts.timeout")
end)

it("applies the requested timeout to ags fallback transport", function()
	local commands = {}
	local module = load_with_command({
		arg = function(value)
			return "[" .. tostring(value) .. "]"
		end,
		ok = function()
			return false
		end,
		output = function(command_line)
			commands[#commands + 1] = command_line
			return "reply\n"
		end,
	})

	assert_equal(module.request("component", "payload", { timeout = 1.25 }), "reply", "fallback response")
	assert(commands[1]:match("timeout %-%-foreground %[1%.25s%] ags request"), "fallback uses opts.timeout")
end)
