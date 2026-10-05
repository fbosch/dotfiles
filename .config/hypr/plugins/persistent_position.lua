local M = { enabled = false }

-- Neither installing the package nor requiring this module may load the plugin by default.
if os.getenv("HYPR_PERSISTENT_POSITION_ENABLED") ~= "1" then
	return M
end

local ready_path
local ok, err = pcall(function()
	ready_path = require("runtime.lib.hypr-ipc").instance_path("persistent-position.ready")
	-- A failed reconfiguration must not leave stale native readiness.
	os.remove(ready_path)

	local plugin_path = assert(os.getenv("HYPR_PERSISTENT_POSITION_PLUGIN"), "plugin path is unavailable")
	assert(plugin_path ~= "", "plugin path is unavailable")
	local state_home = os.getenv("XDG_STATE_HOME")
	if not state_home or state_home == "" then
		state_home = assert(os.getenv("HOME"), "XDG_STATE_HOME or HOME is required") .. "/.local/state"
	end
	local selectors = require("plugins.persistent_position_selectors")
	local readiness = require("plugins.persistent_position_readiness")

	hl.plugin.load(plugin_path)
	for _, plugin in ipairs(hl.get_loaded_plugins()) do
		if plugin.name == "persistent-position" then
			-- Plugin load can schedule another parse; configure only once its API is registered.
			local config_dir = assert(os.getenv("HOME"), "HOME is required") .. "/.config/hypr"
			local state_path = state_home .. "/hyprland/persistent-position.state"
			local api = hl.plugin.persistent_position
			assert(api.state_version and api.state_version() == 2, "native state API v2 is required")
			local state = require("plugins.persistent_state")
			state.import_file(api, state_path, config_dir .. "/rules/window-state.lua", selectors)
			local configured, config_err = hl.plugin.persistent_position.configure(state_path, selectors)
			assert(configured, "configure: " .. tostring(config_err))
			readiness.publish(ready_path, selectors, true)
			M.enabled = true
			M.native_state = true
			break
		end
	end
end)

if not ok then
	if ready_path then
		os.remove(ready_path)
	end
	M.error = tostring(err)
	io.stderr:write("persistent-position: ", M.error, "; native persistence is unavailable\n")
end

return M
