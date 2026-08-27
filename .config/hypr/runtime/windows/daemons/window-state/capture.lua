-- Pure window-state capture: turns normalized selectors, clients, and
-- monitors into the deterministic JSON snapshot persisted by the daemon.

local json = require("lib.json")
local state_rules = require("runtime.windows.daemons.window-state.rules")

local M = {}

local lua_pattern_cache = {}

local function lua_pattern_for_regex(pattern)
	if lua_pattern_cache[pattern] then
		return lua_pattern_cache[pattern]
	end

	local parts = {}
	local escaped = false
	for index = 1, #pattern do
		local char = pattern:sub(index, index)
		if escaped then
			parts[#parts + 1] = "%" .. char
			escaped = false
		elseif char == "\\" then
			escaped = true
		elseif char == "-" then
			parts[#parts + 1] = "%-"
		else
			parts[#parts + 1] = char
		end
	end

	if escaped then
		parts[#parts + 1] = "\\"
	end

	local converted = table.concat(parts)
	lua_pattern_cache[pattern] = converted
	return converted
end

local function field_matches(value, pattern)
	if value == nil then
		return false
	end

	local ok, matched = pcall(string.match, tostring(value), lua_pattern_for_regex(pattern))
	return ok and matched ~= nil
end

local function matched_selector(client, selectors)
	for _, selector in ipairs(selectors) do
		local field = state_rules.matcher_client_field(selector.matcher)
		if selector.geometry_authority == nil and field and field_matches(client[field], selector.pattern) then
			local exclude = selector.exclude
			local exclude_field = exclude and state_rules.matcher_client_field(exclude.matcher)
			local excluded = false
			if exclude_field then
				for _, pattern in ipairs(exclude.patterns) do
					if field_matches(client[exclude_field], pattern) then
						excluded = true
						break
					end
				end
			end
			if not excluded then
				return selector
			end
		end
	end

	return nil
end

local function monitor_index(monitors)
	local indexed = {}
	for _, monitor in ipairs(monitors) do
		indexed[monitor.id] = {
			name = monitor.name,
			x = monitor.x,
			y = monitor.y,
		}
	end
	return indexed
end

local function persisted_tags(client, selector)
	if type(selector.persist_tags) ~= "table" then
		return nil
	end

	local client_tags = {}
	for _, tag in ipairs(client.tags or {}) do
		if type(tag) == "string" then
			client_tags[tag:gsub("%*$", "")] = true
		end
	end

	local tags = {}
	for _, tag in ipairs(selector.persist_tags) do
		if client_tags[tag] then
			tags[1] = tag
			break
		end
	end

	return tags
end

function M.snapshot(selectors, clients, monitors)
	if #selectors == 0 then
		return "[]"
	end

	local monitors_by_id = monitor_index(monitors)
	local windows = {}
	for _, client in ipairs(clients) do
		local windowed = (tonumber(client.fullscreen) or 0) == 0 and (tonumber(client.fullscreenClient) or 0) == 0
		if client.floating == true and windowed then
			local selector = matched_selector(client, selectors)
			if selector then
				local monitor = monitors_by_id[tostring(client.monitor)] or { name = "", x = 0, y = 0 }
				windows[#windows + 1] = {
					class = client.class,
					matcher = selector.matcher,
					pattern = selector.pattern,
					monitor = selector.per_monitor and monitor.name or "",
					target_monitor = selector.restore_monitor and monitor.name or nil,
					x = client.at[1] - monitor.x,
					y = client.at[2] - monitor.y,
					width = client.size[1],
					height = client.size[2],
					tags = persisted_tags(client, selector),
				}
			end
		end
	end

	table.sort(windows, function(left, right)
		return tostring(left.class or "") < tostring(right.class or "")
	end)
	return json.encode(windows)
end

return M
