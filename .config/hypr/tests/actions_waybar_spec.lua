local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/actions_waybar_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

describe("Waybar actions", function()
	before_each(function()
		package.loaded["actions.waybar"] = nil
		package.loaded["lib.command"] = {
			line = function(...)
				return table.concat({ ... }, " ")
			end,
		}
		package.loaded["lib.paths"] = {
			runtime_script = function(path)
				return "/runtime/" .. path
			end,
		}
		---@diagnostic disable-next-line: missing-fields
		_G.hl = { dsp = {
			exec_cmd = function(command_line)
				return command_line
			end,
		} }
	end)

	after_each(function()
		_G.hl = nil
		package.loaded["lib.command"] = nil
		package.loaded["lib.paths"] = nil
	end)

	it("routes every public binding through the control seam", function()
		local waybar = require("actions.waybar")
		for intent, command_line in pairs({ hold = waybar.hold, prewarm = waybar.prewarm, release = waybar.release }) do
			local rendered = tostring(command_line)
			assert.matches("waybar%-control%.sh " .. intent, rendered)
			assert.matches("notify%-send", rendered)
			assert.is_nil(rendered:match("waybar%-monitor%.sh"))
		end
	end)
end)
