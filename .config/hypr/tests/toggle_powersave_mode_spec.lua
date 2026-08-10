local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/toggle_powersave_mode_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local recorded_commands = {}
local state = {}
local modules = {
	"lib.command",
	"lib.fs",
	"lib.notify",
	"lib.paths",
	"lib.profile_state",
	"actions.toggle-powersave-mode",
}
local original_modules = {}

for _, name in ipairs(modules) do
	original_modules[name] = package.loaded[name]
end

package.loaded["lib.command"] = {
	line = function(...)
		return table.concat({ ... }, " ")
	end,
	ok = function(value)
		recorded_commands[#recorded_commands + 1] = value
		return true
	end,
	output_line = function()
		return ""
	end,
}
package.loaded["lib.fs"] = {
	exists = function()
		return false
	end,
}
package.loaded["lib.notify"] = { send = function() end }
package.loaded["lib.paths"] = {
	runtime_script = function(name)
		return name
	end,
}
package.loaded["lib.profile_state"] = {
	read = function()
		return state
	end,
}
package.loaded["actions.toggle-powersave-mode"] = nil

local toggle = require("actions.toggle-powersave-mode")

for _, name in ipairs(modules) do
	package.loaded[name] = original_modules[name]
end

it("sets manual Powersave when an automatic claim is active", function()
	state = {
		selection = "auto",
		resolved = "powersave",
		sources = { gaming = {}, powersave = { idle = 1 } },
	}
	recorded_commands = {}
	toggle.toggle_powersave_mode()
	assert.are.equal("profiles/profilectl.sh set-manual powersave", recorded_commands[1])
end)

it("clears only a manual Powersave selection", function()
	state = {
		selection = "powersave",
		resolved = "powersave",
		sources = { gaming = {}, powersave = { idle = 1 } },
	}
	recorded_commands = {}
	toggle.toggle_powersave_mode()
	assert.are.equal("profiles/profilectl.sh clear-manual", recorded_commands[1])
end)
