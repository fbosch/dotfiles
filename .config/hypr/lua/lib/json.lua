local M = {}

local function escape_string(value)
	return tostring(value):gsub('[%z\1-\31\\"]', function(char)
		local escapes = {
			["\\"] = "\\\\",
			['"'] = '\\"',
			["\b"] = "\\b",
			["\f"] = "\\f",
			["\n"] = "\\n",
			["\r"] = "\\r",
			["\t"] = "\\t",
		}

		return escapes[char] or string.format("\\u%04x", char:byte())
	end)
end

local function is_array(value)
	local count = 0
	for key in pairs(value) do
		if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then
			return false
		end

		count = count + 1
	end

	return count == #value
end

function M.encode(value)
	local kind = type(value)

	if kind == "nil" then
		return "null"
	end

	if kind == "boolean" or kind == "number" then
		return tostring(value)
	end

	if kind == "string" then
		return '"' .. escape_string(value) .. '"'
	end

	if kind ~= "table" then
		error("cannot encode JSON value of type " .. kind)
	end

	local parts = {}
	if is_array(value) then
		for index, item in ipairs(value) do
			parts[index] = M.encode(item)
		end

		return "[" .. table.concat(parts, ",") .. "]"
	end

	local keys = {}
	for key in pairs(value) do
		keys[#keys + 1] = key
	end
	table.sort(keys)

	for _, key in ipairs(keys) do
		parts[#parts + 1] = M.encode(key) .. ":" .. M.encode(value[key])
	end

	return "{" .. table.concat(parts, ",") .. "}"
end

return M
