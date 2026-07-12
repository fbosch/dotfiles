local M = {}

---@class GeneratedRule
---@field id string Stable generated-rule identifier.
---@field match table Hyprland window selector.
---@field effects table Hyprland rule properties merged with `match` before registration.
---@field source? string Rule generator identifier.
---@field comment? string Human-readable generation context.

function M.validate(rule)
	if type(rule) ~= "table" then
		return "expected a table"
	elseif type(rule.id) ~= "string" then
		return "expected string id"
	elseif type(rule.match) ~= "table" then
		return "expected table match"
	elseif type(rule.effects) ~= "table" then
		return "expected table effects"
	elseif rule.source ~= nil and type(rule.source) ~= "string" then
		return "expected string source"
	elseif rule.comment ~= nil and type(rule.comment) ~= "string" then
		return "expected string comment"
	end

	return nil
end

function M.compile(rule)
	local compiled = {
		match = rule.match,
	}

	for key, value in pairs(rule.effects) do
		compiled[key] = value
	end

	return compiled
end

function M.format_pair(first, second)
	return tostring(first) .. " " .. tostring(second)
end

function M.parse_pair(value)
	if type(value) == "table" then
		return tonumber(value[1]), tonumber(value[2])
	end

	if type(value) ~= "string" then
		return nil, nil
	end

	local first, second = value:match("^%s*(%S+)%s+(%S+)%s*$")
	return tonumber(first), tonumber(second)
end

return M
