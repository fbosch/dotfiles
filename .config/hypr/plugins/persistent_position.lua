local M = { enabled = false }

-- Neither installing the package nor requiring this module may load the plugin by default.
if os.getenv("HYPR_PERSISTENT_POSITION_ENABLED") ~= "1" then
	return M
end

local ok, err = pcall(function()
	local plugin_path = assert(os.getenv("HYPR_PERSISTENT_POSITION_PLUGIN"), "plugin path is unavailable")
	assert(plugin_path ~= "", "plugin path is unavailable")
	local state_home = os.getenv("XDG_STATE_HOME")
	if not state_home or state_home == "" then
		state_home = assert(os.getenv("HOME"), "XDG_STATE_HOME or HOME is required") .. "/.local/state"
	end
	local selectors = require("plugins.persistent_position_selectors")

	hl.plugin.load(plugin_path)
	for _, plugin in ipairs(hl.get_loaded_plugins()) do
		if plugin.name == "persistent-position" then
			-- Plugin load can schedule another parse; configure only once its API is registered.
			local state_path = state_home .. "/hyprland/persistent-position.state"
			local api = hl.plugin.persistent_position
			assert(api.state_version and api.state_version() == 2, "native state API v2 is required")
			local configured, config_err = hl.plugin.persistent_position.configure(state_path, selectors)
			assert(configured, "configure: " .. tostring(config_err))
			M.enabled = true
			M.native_state = true
			break
		end
	end
end)

if not ok then
	M.error = tostring(err)
	io.stderr:write("persistent-position: ", M.error, "; native persistence is unavailable\n")
end

return M
