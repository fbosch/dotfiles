---@class TransientPlacementRule
---@field parent_class string
---@field child_class string
---@field child_title_prefixes? string[]
---@field infer_focused_parent? boolean
---@field no_anim? boolean

local M = {}

---@param rules TransientPlacementRule[]
---@return boolean, string?
function M.configure(rules)
	local ok, result, config_error = pcall(function()
		local plugin_path = assert(os.getenv("HYPR_TRANSIENT_PLACEMENT_PLUGIN"), "plugin path is unavailable")
		assert(plugin_path ~= "", "plugin path is unavailable")
		hl.plugin.load(plugin_path)
		for _, plugin in ipairs(hl.get_loaded_plugins()) do
			if plugin.name == "transient-placement" then
				local configured, err = hl.plugin.transient_placement.configure(rules)
				assert(configured, "configure: " .. tostring(err))
				return true
			end
		end
		-- Initial loading schedules another config parse; that parse applies the policy.
		return false, "deferred"
	end)

	if not ok then
		io.stderr:write("transient-placement: ", tostring(result), "; configuration was not applied\n")
		return false, tostring(result)
	end
	return result, config_error
end

return M
