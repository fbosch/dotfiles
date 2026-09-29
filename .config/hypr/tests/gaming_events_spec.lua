local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/gaming_events_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

describe("Gamescope title transitions", function()
	local previous_hl
	local handlers
	local dispatches
	local windows
	local deferred

	before_each(function()
		previous_hl = _G.hl
		handlers, dispatches, windows, deferred = {}, {}, {}, nil
		_G.hl = {
			timer = function(callback, options)
				assert.same({ timeout = 100, type = "oneshot" }, options)
				deferred = callback
			end,
			get_windows = function()
				return windows
			end,
			on = function(name, callback)
				handlers[name] = callback
			end,
			dispatch = function(action)
				dispatches[#dispatches + 1] = action
			end,
			dsp = { window = {
				fullscreen_state = function(options)
					return options
				end,
			} },
		}
		package.loaded["gaming.events"] = nil
		require("gaming.events").register()
	end)

	after_each(function()
		_G.hl = previous_hl
		package.loaded["gaming.events"] = nil
	end)

	it("does not fullscreen Battle.net and applies the game policy after a Gamescope title change", function()
		local window = {
			class = "gamescope",
			initial_title = "Battle.net Login",
			title = "Battle.net",
			address = "0x123",
			fullscreen = 0,
			fullscreen_client = 0,
		}
		handlers["window.title"](window)
		assert.are.equal(0, #dispatches)

		window.title = "World of Warcraft"
		handlers["window.title"](window)
		assert.same({ internal = 2, client = 0, action = "set", window = "address:0x123" }, dispatches[1])
		window.fullscreen = 2
		handlers["window.title"](window)
		assert.are.equal(1, #dispatches)
	end)

	it("does not force direct Battle.net fullscreen", function()
		handlers["window.title"]({ class = "battle.net.exe", title = "Battle.net", initial_title = "Battle.net Login" })
		assert.are.equal(0, #dispatches)
	end)

	it("restores fullscreen policies on workspace 10 after reload without focusing", function()
		local function window(address, class, title, workspace, fullscreen)
			return {
				address = address,
				class = class,
				title = title,
				initial_title = title,
				workspace = { id = workspace },
				fullscreen = fullscreen,
				fullscreen_client = 0,
			}
		end
		windows = {
			window("0x10", "wow.exe", "World of Warcraft", 10, 0),
			window("0x11", "gamescope", "Battle.net Login", 10, 0),
			window("0x12", "wow.exe", "World of Warcraft", 2, 0),
			window("0x13", "wow.exe", "World of Warcraft", 10, 2),
			window("0x14", "steam_app_elderscrollsonline", "Elder Scrolls Online", 10, 0),
			window("0x15", "unmatched", "other", 10, 0),
			window("0x16", "bg3", "Baldur's Gate 3", 10, 0),
			window("0x17", "gamescope", "Warcraft III", 10, 0),
		}
		handlers["config.reloaded"]()
		assert.are.equal(0, #dispatches)
		assert.is_function(deferred)
		deferred()
		assert.same({
			{ internal = 2, client = 0, action = "set", window = "address:0x10" },
			{ internal = 2, client = 0, action = "set", window = "address:0x16" },
			{ internal = 2, client = 0, action = "set", window = "address:0x17" },
		}, dispatches)
	end)
end)
