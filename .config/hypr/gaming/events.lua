local async = require("lib.async")
local matcher = require("gaming.matcher")
local policies = require("gaming.policies")

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

local function register_title_handler()
	-- Gamescope can map as Battle.net before changing its title to the game.
	hl.on("window.title", function(window)
		if not matcher.is_gamescope_window(window) then
			return
		end

		for _, policy in ipairs(policies.games) do
			if policy.gamescope_launcher ~= nil then
				for _, selector in ipairs(policy.gamescope_launcher.selectors) do
					if matcher.matches_selector(window, selector) then
						set_fullscreen_state(window, policy.gamescope_launcher)
						return
					end
				end
			end
		end

		local game, is_launcher = matcher.match(window)
		if game ~= nil and not is_launcher then
			set_fullscreen_state(window, game)
		end
	end)
end

local function register_reload_handler()
	-- Reload can clear fullscreen after config.reloaded fires, without a window.fullscreen event.
	hl.on("config.reloaded", function()
		async.defer(function()
			for _, window in ipairs(hl.get_windows()) do
				local workspace = window.workspace
				if workspace and tostring(workspace.id or workspace.name) == policies.workspace and window.address then
					local launcher_policy
					for _, policy in ipairs(policies.games) do
						if policy.gamescope_launcher and matcher.is_gamescope_window(window) then
							for _, selector in ipairs(policy.gamescope_launcher.selectors) do
								if matcher.matches_selector(window, selector) then
									launcher_policy = policy.gamescope_launcher
									break
								end
							end
						end
						if launcher_policy then
							break
						end
					end

					if launcher_policy then
						set_fullscreen_state(window, launcher_policy)
					else
						local game, is_launcher = matcher.match(window)
						if game and not is_launcher then
							set_fullscreen_state(window, game)
						end
					end
				end
			end
		end, 100)
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
		if window == nil then
			return
		end

		local game, is_launcher = matcher.match(window)
		if game == nil or is_launcher or game.presentation == nil or game.presentation.direct_scanout == 0 then
			return
		end

		set_fullscreen_state(window, game)
	end)
end

function M.register()
	register_reload_handler()
	register_fullscreen_handler()
	register_open_handler()
	register_title_handler()
end

return M
