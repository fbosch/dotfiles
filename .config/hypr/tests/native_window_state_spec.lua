local source_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = source_path:match("^(.*)/tests/native_window_state_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path
local adapter = "plugins.persistent_position"
local policy = "rules.persistent_position"

describe("native-only window persistence", function()
	local old_hl, saved_adapter, saved_policy, rules
	before_each(function()
		old_hl, saved_adapter, saved_policy = _G.hl, package.loaded[adapter], package.loaded[policy]
		package.loaded[adapter] = { enabled = true }
		package.loaded[policy] = nil
		rules = {}
		_G.hl = {
			window_rule = function(rule)
				rules[#rules + 1] = rule
			end,
		}
	end)
	after_each(function()
		_G.hl = old_hl
		package.loaded[adapter], package.loaded[policy] = saved_adapter, saved_policy
	end)

	it("declares native rules with the existing durable state identities", function()
		require(policy)
		local by_id = {}
		for _, rule in ipairs(rules) do
			local id = rule["persistent_position:remember"]
			assert.is_nil(by_id[id], "duplicate persistence identity: " .. id)
			by_id[id] = rule
		end
		for _, id in ipairs({
			"nemo-main",
			"desktop-portal-gtk",
			"bitwarden",
			"gnome-text-editor",
			"flake-update-terminal",
			"mullvad-vpn",
			"infinitefusion",
			"gparted",
			"pupgui2",
			"mpris-timer",
			"steam-app-0",
			"signal",
			"svp-manager",
			"battle-net",
			"zenimax-launcher",
			"codex",
			"picture-in-picture",
			"flatseal",
			"gnome-calendar",
		}) do
			assert.is_table(by_id[id], "missing durable identity: " .. id)
		end
		assert.same(
			{ class = "^nemo$", initial_title = "negative:^(File Operations|Preparing)$" },
			by_id["nemo-main"].match
		)
		assert.same({
			match = { initial_title = "^Picture-in-Picture$" },
			["persistent_position:remember"] = "picture-in-picture",
			["persistent_position:profile"] = "pip",
		}, by_id["picture-in-picture"])
	end)

	it("does not declare plugin effects when loading or configuration is unavailable", function()
		package.loaded[adapter] = { enabled = false, error = "unavailable" }
		_G.hl = nil
		assert.has_no.errors(function()
			require(policy)
		end)
		assert.same({}, rules)
	end)
	it("rejects the retired generated window-state phase", function()
		assert.has_error(function()
			require("rule_loader").apply_window_rule_phase("/missing", "window_state")
		end, "unknown window rule phase: window_state")
	end)

	it("encodes accepted PiP placement as a bounded native call without a reload", function()
		local message =
			require("lib.persistent_pip").request({ kind = "free", target_monitor = 'DP-2"', x = 42, y = 73 })
		local captured
		local before = _G.hl
		_G.hl = {
			plugin = {
				persistent_position = {
					accept_pip_placement = function(value)
						captured = value
						return true
					end,
				},
			},
		}
		local ok, err = pcall(assert(loadstring(message:sub(6))))
		_G.hl = before
		assert.is_true(ok, tostring(err))
		assert.same({ kind = "free", target_monitor = 'DP-2"', x = 42, y = 73 }, captured)
		assert.is_nil(message:find("reload", 1, true))
	end)
end)
