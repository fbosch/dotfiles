local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/window_state_rules_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local command_calls = 0

describe("window-state rules", function()
	local rules
	local temp_dir
	local options

	before_each(function()
		command_calls = 0
		package.loaded["lib.command"] = {
			arg = function(value)
				return string.format("%q", value)
			end,
			ok = function(line)
				command_calls = command_calls + 1
				return os.execute(line) == 0
			end,
		}
		package.loaded["runtime.windows.daemons.window-state.rules"] = nil
		rules = require("runtime.windows.daemons.window-state.rules")
		temp_dir = os.tmpname()
		os.remove(temp_dir)
		options = {
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
	end)

	after_each(function()
		os.execute("rm -rf " .. string.format("%q", temp_dir))
	end)

	it("skips writes when generated rules are unchanged", function()
		assert.is_true(rules.write_rules_file(options))
		assert.are.equal(1, command_calls)

		command_calls = 0
		assert.is_false(rules.write_rules_file(options))
		assert.are.equal(0, command_calls)
	end)
end)
