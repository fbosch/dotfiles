local M = {}
M.null = {}

local encode_escapes = {
	["\\"] = "\\\\",
	['"'] = '\\"',
	["\b"] = "\\b",
	["\f"] = "\\f",
	["\n"] = "\\n",
	["\r"] = "\\r",
	["\t"] = "\\t",
}

local function escape_string(value)
	value = tostring(value)
	if not value:find('[%z\1-\31\\"]') then
		return value
	end

	return value:gsub('[%z\1-\31\\"]', function(char)
		return encode_escapes[char] or string.format("\\u%04x", char:byte())
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

local function utf8_char(codepoint)
	if codepoint <= 0x7f then
		return string.char(codepoint)
	elseif codepoint <= 0x7ff then
		return string.char(
			0xc0 + math.floor(codepoint / 0x40),
			0x80 + (codepoint % 0x40)
		)
	elseif codepoint <= 0xffff then
		return string.char(
			0xe0 + math.floor(codepoint / 0x1000),
			0x80 + (math.floor(codepoint / 0x40) % 0x40),
			0x80 + (codepoint % 0x40)
		)
	elseif codepoint <= 0x10ffff then
		return string.char(
			0xf0 + math.floor(codepoint / 0x40000),
			0x80 + (math.floor(codepoint / 0x1000) % 0x40),
			0x80 + (math.floor(codepoint / 0x40) % 0x40),
			0x80 + (codepoint % 0x40)
		)
	end

	return nil
end

local function parse_unicode_escape(source, index)
	local hex = source:sub(index + 2, index + 5)
	local codepoint = tonumber(hex, 16)
	if not codepoint or #hex ~= 4 then
		decode_error(source, index, "invalid unicode escape")
	end

	local next_index = index + 6
	if codepoint >= 0xd800 and codepoint <= 0xdbff then
		if source:sub(next_index, next_index + 1) ~= "\\u" then
			decode_error(source, index, "missing low surrogate")
		end

		local low = tonumber(source:sub(next_index + 2, next_index + 5), 16)
		if not low or low < 0xdc00 or low > 0xdfff then
			decode_error(source, next_index, "invalid low surrogate")
		end

		codepoint = 0x10000 + ((codepoint - 0xd800) * 0x400) + (low - 0xdc00)
		next_index = next_index + 6
	elseif codepoint >= 0xdc00 and codepoint <= 0xdfff then
		decode_error(source, index, "unexpected low surrogate")
	end

	local encoded = utf8_char(codepoint)
	if not encoded then
		decode_error(source, index, "invalid unicode codepoint")
	end

	return encoded, next_index
end

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
				local decoded
				decoded, cursor = parse_unicode_escape(source, next_special)
				parts[#parts + 1] = decoded
			else
				local decoded = decode_escapes[escape]
				if decoded == nil then
					decode_error(source, next_special, "invalid string escape")
				end

				parts[#parts + 1] = decoded
				cursor = next_special + 2
			end
			start = cursor
		end
	end

	decode_error(source, index, "unterminated string")
end

local function parse_number(source, index)
	local start_index, end_index = source:find("^-?%d+%.?%d*[eE]?[+-]?%d*", index)
	if not start_index then
		decode_error(source, index, "expected number")
	end

	local literal = source:sub(start_index, end_index)
	if literal:match("^-?0%d") then
		decode_error(source, index, "leading zero in number")
	elseif literal:match("%.$") then
		decode_error(source, index, "expected fractional digit")
	elseif literal:match("[eE][+-]?$") then
		decode_error(source, index, "expected exponent digit")
	end

	local number = tonumber(literal)
	if not number then
		decode_error(source, index, "invalid number")
	end

	return number, end_index + 1
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
	local byte = source:byte(index)
	local char = source:sub(index, index)

	if char == '"' then
		return parse_string(source, index)
	elseif char == "{" then
		return parse_object(source, index)
	elseif char == "[" then
		return parse_array(source, index)
	elseif byte == 45 or (byte and byte >= 48 and byte <= 57) then
		return parse_number(source, index)
	elseif source:sub(index, index + 3) == "null" then
		return M.null, index + 4
	elseif source:sub(index, index + 3) == "true" then
		return true, index + 4
	elseif source:sub(index, index + 4) == "false" then
		return false, index + 5
	end

	decode_error(source, index, "unexpected JSON value")
end

local encode_value

function encode_value(value)
	local kind = type(value)

	if kind == "nil" or value == M.null then
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
			parts[index] = encode_value(item)
		end

		return "[" .. table.concat(parts, ",") .. "]"
	end

	local keys = {}
	for key in pairs(value) do
		keys[#keys + 1] = key
	end
	table.sort(keys)

	for _, key in ipairs(keys) do
		parts[#parts + 1] = encode_value(key) .. ":" .. encode_value(value[key])
	end

	return "{" .. table.concat(parts, ",") .. "}"
end

function M.encode(value)
	return encode_value(value)
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

function M.decode_or(source, fallback)
	if type(source) ~= "string" or source == "" then
		return fallback
	end

	local ok, decoded = pcall(M.decode, source)
	if ok then
		return decoded
	end

	return fallback
end

function M.array(source)
	local decoded = type(source) == "table" and source or M.decode_or(source, {})
	if type(decoded) == "table" and is_array(decoded) then
		return decoded
	end

	return {}
end

function M.object(source)
	local decoded = type(source) == "table" and source or M.decode_or(source, {})
	if type(decoded) ~= "table" or is_array(decoded) then
		return {}
	end

	for key in pairs(decoded) do
		if type(key) ~= "string" then
			return {}
		end
	end

	return decoded
end

return M
