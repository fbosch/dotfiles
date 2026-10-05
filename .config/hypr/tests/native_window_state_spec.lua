local source_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = source_path:match("^(.*)/tests/native_window_state_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path
local state = require("plugins.persistent_state")
local selectors = require("plugins.persistent_position_selectors")
local function legacy(pattern, effects, extra)
	local rule =
		{ source = "window-state", matcher = "match:class", pattern = pattern, monitor = "DP-2", effects = effects }
	for key, value in pairs(extra or {}) do
		rule[key] = value
	end
	return rule
end

describe("native-only window persistence", function()
	it("preserves all selector policies including the separate PiP authority", function()
		assert.equals(20, #selectors)
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

	it("imports size-only records without inventing a position", function()
		local records =
			state.legacy_records({ legacy("^nemo$", { size = "800 600", fullscreen_state = "0 0" }) }, selectors)
		assert.same({ { id = "nemo-main", monitor = "DP-2", width = 800, height = 600, windowed = true } }, records)
	end)

	it("imports corner and free placement without trying to parse corner expressions as numbers", function()
		local rule = legacy("^Picture-in-Picture$", { move = "(monitor_w-window_w-15) 15", monitor = "DP-2" }, {
			matcher = "match:initial_title",
			monitor = "",
			target_monitor = "DP-2",
			tags = { "pip-top-right" },
		})
		assert.same({
			{
				id = "picture-in-picture",
				monitor = "",
				kind = "corner",
				corner = "top-right",
				target_monitor = "DP-2",
			},
		}, state.legacy_records({ rule }, selectors))
		rule.placement = { kind = "free", target_monitor = "HDMI-A-2", x = 80, y = 120 }
		assert.same(
			{ { id = "picture-in-picture", monitor = "", kind = "free", target_monitor = "HDMI-A-2", x = 80, y = 120 } },
			state.legacy_records({ rule }, selectors)
		)
	end)

	it("imports old MEGA identities and rejects invalid size instead of disabling legacy rules", function()
		assert.equals(
			"mega",
			state.legacy_records({ legacy([=[nz\.co\.mega\.]=], { move = "10 20", size = "400 300" }) }, selectors)[1].id
		)
		assert.has_error(function()
			state.legacy_records({ legacy("^nemo$", { size = "0 300" }) }, selectors)
		end)
	end)

	it("treats a missing legacy file as empty but rejects malformed data", function()
		local path = os.tmpname()
		os.remove(path)
		local seen
		local api = {
			import_legacy = function(_, records)
				seen = records
				return true
			end,
		}
		state.import_file(api, "/tmp/unused-native-state", path, selectors)
		assert.same({}, seen)
		local file = assert(io.open(path, "w"))
		file:write("not Lua syntax")
		file:close()
		local ok = pcall(state.import_file, api, "/tmp/unused-native-state", path, selectors)
		os.remove(path)
		assert.is_false(ok)
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
