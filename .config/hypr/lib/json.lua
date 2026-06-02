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

local decode_escapes = {
	['"'] = '"',
	["\\"] = "\\",
	["/"] = "/",
	b = "\b",
	f = "\f",
	n = "\n",
	r = "\r",
	t = "\t",
}

local function decode_error(source, index, message)
	error(message .. " at byte " .. tostring(index) .. " near " .. string.format("%q", source:sub(index, index + 20)), 0)
end

local function skip_space(source, index)
	while true do
		local byte = source:byte(index)
		if byte ~= 32 and byte ~= 10 and byte ~= 13 and byte ~= 9 then
			return index
		end
		index = index + 1
	end
end

local parse_value

local function parse_string(source, index)
	if source:sub(index, index) ~= '"' then
		decode_error(source, index, "expected string")
	end

	local cursor = index + 1
	local start = cursor
	local parts = nil
	while true do
		local next_special = source:find('[\\"]', cursor)
		if not next_special then
			break
		end

		local char = source:sub(next_special, next_special)
		if char == '"' then
			if not parts then
				return source:sub(start, next_special - 1), next_special + 1
			end

			parts[#parts + 1] = source:sub(start, next_special - 1)
			return table.concat(parts), next_special + 1
		elseif char == "\\" then
			parts = parts or {}
			parts[#parts + 1] = source:sub(start, next_special - 1)

			local escape = source:sub(next_special + 1, next_special + 1)
			if escape == "u" then
				decode_error(source, next_special, "unicode escapes are not supported")
			end

			local decoded = decode_escapes[escape]
			if decoded == nil then
				decode_error(source, next_special, "invalid string escape")
			end

			parts[#parts + 1] = decoded
			cursor = next_special + 2
			start = cursor
		end
	end

	decode_error(source, index, "unterminated string")
end

local function parse_number(source, index)
	local start_index, end_index = source:find("^-?%d+%.?%d*", index)
	if not start_index then
		decode_error(source, index, "expected number")
	end

	return tonumber(source:sub(start_index, end_index)), end_index + 1
end

local function parse_array(source, index)
	local result = {}
	index = skip_space(source, index + 1)
	if source:sub(index, index) == "]" then
		return result, index + 1
	end

	while index <= #source do
		local value
		value, index = parse_value(source, index)
		result[#result + 1] = value

		index = skip_space(source, index)
		local separator = source:sub(index, index)
		if separator == "]" then
			return result, index + 1
		elseif separator ~= "," then
			decode_error(source, index, "expected array separator")
		end
		index = skip_space(source, index + 1)
	end

	decode_error(source, index, "unterminated array")
end

local function parse_object(source, index)
	local result = {}
	index = skip_space(source, index + 1)
	if source:sub(index, index) == "}" then
		return result, index + 1
	end

	while index <= #source do
		local key
		key, index = parse_string(source, index)
		index = skip_space(source, index)
		if source:sub(index, index) ~= ":" then
			decode_error(source, index, "expected object key separator")
		end

		local value
		value, index = parse_value(source, index + 1)
		result[key] = value

		index = skip_space(source, index)
		local separator = source:sub(index, index)
		if separator == "}" then
			return result, index + 1
		elseif separator ~= "," then
			decode_error(source, index, "expected object separator")
		end
		index = skip_space(source, index + 1)
	end

	decode_error(source, index, "unterminated object")
end

function parse_value(source, index)
	index = skip_space(source, index)
	local char = source:sub(index, index)

	if char == '"' then
		return parse_string(source, index)
	elseif char == "{" then
		return parse_object(source, index)
	elseif char == "[" then
		return parse_array(source, index)
	elseif char == "-" or char:match("%d") then
		return parse_number(source, index)
	elseif source:sub(index, index + 3) == "null" then
		return nil, index + 4
	elseif source:sub(index, index + 3) == "true" then
		return true, index + 4
	elseif source:sub(index, index + 4) == "false" then
		return false, index + 5
	end

	decode_error(source, index, "unexpected JSON value")
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

function M.decode(source)
	if type(source) ~= "string" then
		error("expected JSON string input", 2)
	end

	local value, index = parse_value(source, 1)
	index = skip_space(source, index)
	if index <= #source then
		decode_error(source, index, "trailing JSON content")
	end

	return value
end

return M
