local matcher = require("gaming.matcher")

local M = {}

local function set_fullscreen_state(window, game)
	if game.fullscreen_state == nil then
		return
	end

	local internal, client = game.fullscreen_state:match("^(%d+) (%d+)$")
	internal = tonumber(internal)
	client = tonumber(client)
	if window.fullscreen == internal and window.fullscreen_client == client then
		return
	end

	hl.dispatch(hl.dsp.window.fullscreen_state({
		internal = internal,
		client = client,
		action = "set",
		window = "address:" .. window.address,
	}))
end

local function register_open_handler()
	hl.on("window.open", function(window)
		local game, is_launcher = matcher.match(window)
		if game == nil or is_launcher then
			return
		end

		if game.close_launcher_on_start == true then
			for _, launcher in ipairs(hl.get_windows()) do
				for _, launcher_rule in ipairs(game.launcher_rules or {}) do
					if matcher.matches_selector(launcher, launcher_rule.match) then
						hl.dispatch(hl.dsp.window.kill({ window = "address:" .. launcher.address }))
						break
					end
				end
			end
		end

		if game.focus_on_open == true then
			hl.dispatch(hl.dsp.focus({ window = "address:" .. window.address }))
		end
	end)
end

local function register_fullscreen_handler()
	hl.on("window.fullscreen", function(window)
		local game, is_launcher = matcher.match(window)
		if game ~= nil and is_launcher == false then
			set_fullscreen_state(window, game)
		end
	end)

	hl.on("window.active", function(window)
		local game, is_launcher = matcher.match(window)
		if game == nil or is_launcher or game.presentation == nil or game.presentation.direct_scanout == 0 then
			return
		end

		set_fullscreen_state(window, game)
	end)
end

function M.register()
	register_fullscreen_handler()
	register_open_handler()
end

return M
