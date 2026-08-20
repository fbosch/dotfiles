local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/initial_window_state_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local listener
local dispatched

before_each(function()
	listener = nil
	dispatched = nil
	_G.hl = {
		on = function(event, callback)
			assert.are.equal("window.open", event)
			listener = callback
		end,
		dispatch = function(action)
			dispatched = action
		end,
		dsp = {
			window = {
				fullscreen_state = function(options)
					return options
				end,
			},
		},
	}
	package.loaded["rules.initial-window-state"] = nil
	require("rules.initial-window-state").register()
end)

it("clears an initial client maximize request for a tiled window", function()
	local window = { floating = false, fullscreen_client = 1 }

	listener(window)

	assert.are.same({ internal = 0, client = 0, window = window }, dispatched)
end)

it("preserves initial maximize requests for floating windows", function()
	listener({ floating = true, fullscreen_client = 1 })

	assert.is_nil(dispatched)
end)

it("preserves true fullscreen requests for tiled windows", function()
	listener({ floating = false, fullscreen_client = 2 })

	assert.is_nil(dispatched)
end)
