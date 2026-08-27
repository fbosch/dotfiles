local state_rules = require("runtime.windows.daemons.window-state.rules")

local M = {}

local function is_state_empty(state)
	return not state or state == "" or state == "[]"
end

function M.new(opts)
	local kit = assert(opts.kit, "window-state publication requires a daemon kit")
	local config_dir = assert(opts.config_dir, "window-state publication requires a config directory")
	local reload = assert(opts.reload, "window-state publication requires a reload function")
	local log = assert(opts.log, "window-state publication requires a log function")
	local selectors_lua_file = config_dir .. "/rules/window-state-selectors.lua"
	local rules_lua_file = config_dir .. "/rules/window-state.lua"
	local state_file = kit:instance_path("window-state.cache")
	local rules_cache = {}
	local activation_pending = false

	local function load_rules_cache()
		rules_cache = state_rules.load_rules_cache(rules_lua_file)
	end

	local function ensure_rules_cache()
		if not next(rules_cache) then
			load_rules_cache()
		end
	end

	local function write_rules(selectors, cache)
		return state_rules.write_rules_file({
			cache = cache or rules_cache,
			selectors = selectors,
			config_dir = config_dir,
			selectors_lua_file = selectors_lua_file,
			rules_lua_file = rules_lua_file,
		})
	end

	local function refresh_rules(changed)
		if changed == false then
			return false
		end

		activation_pending = false
		if not reload() then
			log("WARNING: Failed to refresh window-state rules")
			return false
		end
		return true
	end

	local publisher = {}

	function publisher:publish(snapshot, selectors)
		if is_state_empty(snapshot) then
			return false
		end

		ensure_rules_cache()
		state_rules.prune_rules_cache(rules_cache, selectors)
		state_rules.update_cache_from_windows(rules_cache, snapshot, nil, selectors)

		-- Make both recovery artifacts durable before activating the new rules.
		local changed = write_rules(selectors)
		kit:write_shared_file(state_file, snapshot .. "\n")
		refresh_rules(changed)
		return changed
	end

	function publisher:reconcile(selectors, force_refresh)
		load_rules_cache()
		state_rules.prune_rules_cache(rules_cache, selectors)
		state_rules.migrate_geometry_authorities(rules_cache, selectors)
		local changed = write_rules(selectors)
		refresh_rules(changed or force_refresh == true)
		return changed
	end

	function publisher:accept_pip_placement(placement, selectors)
		ensure_rules_cache()
		local next_cache = {}
		for key, entry in pairs(rules_cache) do
			next_cache[key] = entry
		end
		state_rules.prune_rules_cache(next_cache, selectors)
		local accepted, err = state_rules.accept_pip_placement(next_cache, selectors, placement)
		if accepted == nil then
			return nil, err
		end

		local changed = write_rules(selectors, next_cache)
		rules_cache = next_cache
		activation_pending = activation_pending or changed
		return true, activation_pending
	end

	function publisher:activate()
		return refresh_rules(activation_pending)
	end

	return publisher
end

return M
