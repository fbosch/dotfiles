local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/transient_placement_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local listener
local dispatched
local parent

before_each(function()
	listener = nil
	dispatched = {}
	parent = nil
	_G.hl = {
		on = function(event, callback)
			assert.are.equal("window.open", event)
			listener = callback
		end,
		get_last_window = function()
			return parent
		end,
		dispatch = function(action)
			table.insert(dispatched, action)
		end,
		dsp = {
			window = {
				set_prop = function(options)
					return { operation = "set_prop", options = options }
				end,
				move = function(options)
					return { operation = "move", options = options }
				end,
			},
		},
	}
	package.loaded["rules.transient_placement"] = nil
	require("rules.transient_placement").register()
end)

it("centers a relabeled Zen popup over its parent window", function()
	parent = {
		class = "app.zen_browser.zen",
		at = { x = 100, y = 200 },
		size = { x = 1200, y = 800 },
	}

	listener({
		address = "0xpopup",
		class = "app.zen_browser.zen-popup",
		at = { x = 0, y = 0 },
		size = { x = 400, y = 300 },
	})

	assert.are.same({
		{
			operation = "set_prop",
			options = { prop = "no_anim", value = "1", window = "address:0xpopup" },
		},
		{
			operation = "move",
			options = { x = 500, y = 450, window = "address:0xpopup" },
		},
	}, dispatched)
end)

it("ignores a normal Zen window", function()
	parent = {
		class = "app.zen_browser.zen",
		at = { x = 100, y = 200 },
		size = { x = 1200, y = 800 },
	}

	listener({
		address = "0xwindow",
		class = "app.zen_browser.zen",
		at = { x = 0, y = 0 },
		size = { x = 400, y = 300 },
	})

	assert.are.same({}, dispatched)
end)
