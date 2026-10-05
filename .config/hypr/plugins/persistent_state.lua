-- Native v2 owns all persisted geometry. Legacy rule data is import-only.
local M = {}
local pip = require("lib.picture_in_picture")

local function identity(selector)
	return selector.matcher .. "\0" .. selector.pattern
end

local function pair(value, positive)
	if value == nil then
		return nil, nil
	end
	assert(type(value) == "string", "invalid legacy geometry")
	local x, y = value:match("^%s*(%S+)%s+(%S+)%s*$")
	x, y = tonumber(x), tonumber(y)
	assert(
		x and y and x == x and y == y and math.abs(x) <= 1000000 and math.abs(y) <= 1000000,
		"invalid legacy geometry"
	)
	assert(not positive or (x > 0 and y > 0), "invalid legacy size")
	return x, y
end

function M.legacy_records(rules, selectors)
	assert(type(rules) == "table", "expected legacy rules table")
	local owned, records = {}, {}
	for _, selector in ipairs(selectors) do
		owned[identity(selector)] = selector
		if selector.id == "mega" then
			owned[selector.matcher .. "\0" .. [=[nz\.co\.mega\.]=]] = selector
		end
	end
	for _, rule in ipairs(rules) do
		local selector = owned[(rule.matcher or "") .. "\0" .. (rule.pattern or "")]
		local effects = rule.effects
		if
			selector
			and rule.source == "window-state"
			and effects
			and (effects.size or effects.move or rule.placement)
		then
			local monitor = selector.per_monitor and rule.monitor or ""
			assert(type(monitor) == "string", "missing legacy monitor")
			local key = selector.id .. "\0" .. monitor
			local record = records[key] or { id = selector.id, monitor = monitor }
			local width, height = pair(effects.size, true)
			if width then
				record.width, record.height = width, height
			end
			if selector.geometry_authority == "pip" then
				local value = rule.placement
				if not value then
					local target = rule.target_monitor or effects.monitor
					local corner
					for name, policy in pairs(pip.corners) do
						for _, tag in ipairs(rule.tags or {}) do
							if tag == policy.tag then
								corner = name
							end
						end
					end
					if corner then
						value = { kind = "corner", corner = corner, target_monitor = target }
					else
						local x, y = pair(effects.move)
						value = { kind = "free", x = x, y = y, target_monitor = target }
					end
				end
				local accepted, err = pip.acceptance.normalize(value)
				assert(accepted, err)
				for field, field_value in pairs(accepted) do
					record[field] = field_value
				end
			else
				if effects.move then
					record.x, record.y = pair(effects.move)
				end
				record.windowed = selector.force_windowed
			end
			records[key] = record
		end
	end
	local result = {}
	for _, record in pairs(records) do
		result[#result + 1] = record
	end
	table.sort(result, function(a, b)
		return a.id .. "\0" .. a.monitor < b.id .. "\0" .. b.monitor
	end)
	return result
end

function M.import_file(api, state_path, legacy_path, selectors)
	local chunk, err = loadfile(legacy_path)
	if not chunk then
		local file, _, code = io.open(legacy_path, "r")
		if file then
			file:close()
		end
		assert(code == 2, err)
	end
	local records = chunk and M.legacy_records(chunk(), selectors) or {}
	local ok, import_err = api.import_legacy(state_path, records)
	assert(ok, import_err)
end

return M
