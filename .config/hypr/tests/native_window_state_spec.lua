local source_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = source_path:match("^(.*)/tests/native_window_state_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path
local selectors = require("plugins.persistent_position_selectors")

describe("native-only window persistence", function()
	it("preserves all selector policies including the separate PiP authority", function()
		assert.equals(19, #selectors)
		local pip
		for _, selector in ipairs(selectors) do
			if selector.id == "picture-in-picture" then
				pip = selector
			end
		end
		assert.same({
			id = "picture-in-picture",
			matcher = "match:initial_title",
			pattern = "^Picture-in-Picture$",
			per_monitor = false,
			restore_monitor = true,
			restore_size = false,
			force_windowed = false,
			geometry_authority = "pip",
		}, pip)
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
