local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/gaming_rules_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local function find_rule(rules, selector)
	for _, rule in ipairs(rules) do
		if selector(rule.match) then
			return rule
		end
	end
end

describe("gaming rules", function()
	local original_hl
	local registered_rules

	before_each(function()
		original_hl = _G.hl
		registered_rules = {}
		_G.hl = {
			window_rule = function(rule)
				table.insert(registered_rules, rule)
			end,
		}
		package.loaded["gaming.rules"] = nil
		require("gaming.rules").register()
	end)

	after_each(function()
		_G.hl = original_hl
		package.loaded["gaming.rules"] = nil
	end)

	it("routes generic games without forcing fullscreen", function()
		local gamescope = find_rule(registered_rules, function(match)
			return match.class == "^(gamescope)$"
		end)
		local steam_app = find_rule(registered_rules, function(match)
			return match.class == "^(steam_app_[0-9]+)$"
		end)

		assert.are.equal("10 silent", gamescope.workspace)
		assert.is_nil(gamescope.fullscreen_state)
		assert.are.equal("10 silent", steam_app.workspace)
		assert.is_nil(steam_app.fullscreen_state)
	end)

	it("keeps explicit fullscreen policies", function()
		local bg3 = find_rule(registered_rules, function(match)
			return match.class == "^bg3$"
		end)
		local world_of_warcraft = find_rule(registered_rules, function(match)
			return match.initial_title == "^World of Warcraft$"
		end)

		assert.are.equal("2 0", bg3.fullscreen_state)
		assert.are.equal("2 0", world_of_warcraft.fullscreen_state)
	end)
end)
