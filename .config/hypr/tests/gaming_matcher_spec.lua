local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/gaming_matcher_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local matcher = require("gaming.matcher")
local policies = require("gaming.policies")

describe("Battle.net selector integration", function()
	it("classifies direct Battle.net as a launcher, but not Gamescope Battle.net", function()
		local direct = { class = "battle.net.exe", title = "Battle.net", initial_title = "Battle.net Login" }
		local game, launcher = matcher.match(direct)
		assert.are.equal("world-of-warcraft", game.name)
		assert.is_true(launcher)
		assert.is_true(matcher.is_profile_excluded(direct))

		local gamescope = { class = "gamescope", title = "Battle.net", initial_title = "Battle.net Login" }
		local scoped_game, scoped_launcher = matcher.match(gamescope)
		assert.are.equal("gamescope", scoped_game.name)
		assert.is_false(scoped_launcher)
		local policy = policies.games[2].gamescope_launcher
		assert.is_true(matcher.matches_selector(gamescope, policy.selectors[1]))
		assert.is_true(matcher.matches_selector(gamescope, policy.selectors[2]))
		assert.is_false(matcher.matches_selector(direct, policy.selectors[1]))
	end)

	it("recognizes a Gamescope title transition to WoW", function()
		local game, launcher =
			matcher.match({ class = "gamescope", initial_title = "Battle.net Login", title = "World of Warcraft" })
		assert.are.equal("world-of-warcraft", game.name)
		assert.is_false(launcher)
		assert.are.equal("2 0", game.fullscreen_state)
	end)
end)
