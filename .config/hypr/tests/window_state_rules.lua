local script_path = arg[0] or ""
local config_dir = script_path:match("^(.*)/tests/window_state_rules%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local command_calls = 0
package.loaded["lib.command"] = {
	arg = function(value)
		return string.format("%q", value)
	end,
	ok = function(line)
		command_calls = command_calls + 1
		return os.execute(line) == 0
	end,
}

local rules = require("runtime.windows.daemons.window-state.rules")
local temp_dir = os.tmpname()
os.remove(temp_dir)

local options = {
	config_dir = temp_dir,
	rules_lua_file = temp_dir .. "/rules/window-state.lua",
	selectors_lua_file = "test-selectors.lua",
	cache = {
		["match:class Test"] = {
			matcher = "match:class",
			pattern = "Test",
			monitor = "DP-1",
			x = 10,
			y = 20,
			width = 300,
			height = 400,
		},
	},
}

local function cleanup()
	os.execute("rm -rf " .. string.format("%q", temp_dir))
end

local ok, err = xpcall(function()
	assert(rules.write_rules_file(options) == true, "changed rules should be written")
	assert(command_calls == 1, "changed rules should create the rules directory")

	command_calls = 0
	assert(rules.write_rules_file(options) == false, "unchanged rules should not be written")
	assert(command_calls == 0, "unchanged rules should not create a directory")
end, debug.traceback)

cleanup()
assert(ok, err)
print("PASS window-state rules skip writes when unchanged")
