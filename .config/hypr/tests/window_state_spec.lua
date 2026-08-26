local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/window_state_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local state = require("lib.window.state")

it("targets a pinned floating window above an overlapping tiled window", function()
	local tiled = {
		address = "0xtiled",
		at = { x = 0, y = 0 },
		size = { x = 1000, y = 1000 },
		workspace = { name = "1" },
		visible = true,
		floating = false,
		pinned = false,
	}
	local pip = {
		address = "0xpip",
		at = { x = 100, y = 100 },
		size = { x = 400, y = 225 },
		workspace = { name = "1" },
		visible = true,
		floating = true,
		pinned = true,
	}
	_G.hl = {
		get_cursor_pos = function()
			return { x = 200, y = 200 }
		end,
		get_active_workspace = function()
			return { name = "1" }
		end,
		-- Hyprland exposes windows bottom-to-top.
		get_windows = function()
			return { tiled, pip }
		end,
	}

	assert.equal(pip, state.at_cursor())
end)
