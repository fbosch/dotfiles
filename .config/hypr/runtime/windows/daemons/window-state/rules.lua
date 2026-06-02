local json = require("lib.json")

local M = {}

local function shell_quote(value)
	return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function read_file(path)
	local handle = io.open(path, "r")
	if not handle then
		return nil
	end

	local content = handle:read("*a")
	handle:close()
	return content
end

local function temp_path_in(directory, prefix)
	local command = "mktemp " .. shell_quote(directory .. "/" .. prefix .. ".XXXXXX")
	local handle = assert(io.popen(command, "r"))
	local path = handle:read("*l")
	handle:close()
	assert(path and path ~= "", "failed to create temporary file")
	return path
end

local matcher_map = {
	["match:class"] = { client_field = "class", lua_key = "class" },
	["match:title"] = { client_field = "title", lua_key = "title" },
	["match:initialClass"] = { client_field = "initialClass", lua_key = "initial_class" },
	["match:initial_class"] = { client_field = "initialClass", lua_key = "initial_class" },
	["match:initialTitle"] = { client_field = "initialTitle", lua_key = "initial_title" },
	["match:initial_title"] = { client_field = "initialTitle", lua_key = "initial_title" },
}

function M.matcher_client_field(matcher)
	local mapped = matcher_map[matcher]
	return mapped and mapped.client_field or nil
end

function M.matcher_lua_key(matcher)
	local mapped = matcher_map[matcher]
	return mapped and mapped.lua_key or nil
end

function M.load_selectors(path)
	local ok, selectors = pcall(dofile, path)
	local normalized = {}
	local matchers = {}

	if not ok or type(selectors) ~= "table" then
		return {
			selectors = normalized,
			matchers_json = "[]",
		}
	end

	for _, selector in ipairs(selectors) do
		if type(selector) == "table" and type(selector.matcher) == "string" and type(selector.pattern) == "string" then
			local field = M.matcher_client_field(selector.matcher)
			if field then
				normalized[#normalized + 1] = selector
				matchers[#matchers + 1] = {
					matcher = selector.matcher,
					pattern = selector.pattern,
					field = field,
				}
			end
		end
	end

	return {
		selectors = normalized,
		matchers_json = json.encode(matchers),
	}
end

local function pattern_is_regex(pattern)
	return pattern:find("[%.%[%]%(%)%*%+%?%^%$]") ~= nil
end

local function rule_pattern(pattern)
	if pattern_is_regex(pattern) then
		return pattern
	end

	return "^" .. pattern .. "$"
end

local function rule_id(matcher, pattern)
	return "window-state:" .. matcher .. ":" .. pattern
end

local function cache_key(matcher, pattern)
	return matcher .. " " .. pattern
end

local function cache_entry(matcher, pattern, monitor, x, y, width, height)
	return {
		matcher = matcher,
		pattern = pattern,
		monitor = monitor,
		x = tonumber(x),
		y = tonumber(y),
		width = tonumber(width),
		height = tonumber(height),
	}
end

local json_escapes = {
	['"'] = '"',
	["\\"] = "\\",
	["/"] = "/",
	b = "\b",
	f = "\f",
	n = "\n",
	r = "\r",
	t = "\t",
}

local function decode_json_string(value)
	return value:gsub("\\(.)", function(escape)
		return json_escapes[escape] or escape
	end)
end

local function skip_space(source, index)
	local _, next_index = source:find("^%s*", index)
	return next_index + 1
end

local function parse_json_string(source, index)
	if source:sub(index, index) ~= '"' then
		return nil, index
	end

	local cursor = index + 1
	local escaped = false
	local parts = {}
	while cursor <= #source do
		local char = source:sub(cursor, cursor)
		if escaped then
			parts[#parts + 1] = "\\" .. char
			escaped = false
		elseif char == "\\" then
			escaped = true
		elseif char == '"' then
			return decode_json_string(table.concat(parts)), cursor + 1
		else
			parts[#parts + 1] = char
		end
		cursor = cursor + 1
	end

	return nil, cursor
end

local function parse_json_number(source, index)
	local start_index, end_index = source:find("^-?%d+%.?%d*", index)
	if not start_index then
		return nil, index
	end

	return tonumber(source:sub(start_index, end_index)), end_index + 1
end

local function parse_json_value(source, index)
	index = skip_space(source, index)
	local char = source:sub(index, index)
	if char == '"' then
		return parse_json_string(source, index)
	end

	if char == "-" or char:match("%d") then
		return parse_json_number(source, index)
	end

	if source:sub(index, index + 3) == "null" then
		return nil, index + 4
	elseif source:sub(index, index + 3) == "true" then
		return true, index + 4
	elseif source:sub(index, index + 4) == "false" then
		return false, index + 5
	end

	return nil, index
end

local function parse_state_object(source, index)
	local object = {}
	index = skip_space(source, index)
	if source:sub(index, index) ~= "{" then
		return nil, index
	end
	index = index + 1

	while index <= #source do
		index = skip_space(source, index)
		if source:sub(index, index) == "}" then
			return object, index + 1
		end

		local key
		key, index = parse_json_string(source, index)
		if not key then
			return nil, index
		end

		index = skip_space(source, index)
		if source:sub(index, index) ~= ":" then
			return nil, index
		end

		local value
		value, index = parse_json_value(source, index + 1)
		object[key] = value

		index = skip_space(source, index)
		local separator = source:sub(index, index)
		if separator == "," then
			index = index + 1
		elseif separator ~= "}" then
			return nil, index
		end
	end

	return nil, index
end

local function iter_state_objects(source)
	local index = skip_space(source, 1)
	if source:sub(index, index) ~= "[" then
		return function() end
	end
	index = index + 1

	return function()
		index = skip_space(source, index)
		if source:sub(index, index) == "]" or index > #source then
			return nil
		end

		local object
		object, index = parse_state_object(source, index)
		if not object then
			return nil
		end

		index = skip_space(source, index)
		if source:sub(index, index) == "," then
			index = index + 1
		end

		return object
	end
end

local function rule_identity(rule)
	if type(rule.matcher) == "string" and type(rule.pattern) == "string" then
		return rule.matcher, rule.pattern
	end

	if type(rule.id) == "string" then
		return rule.id:match("^window%-state:(match:[^:]+):(.+)$")
	end

	return nil, nil
end

function M.load_rules_cache(path)
	local cache = {}
	local ok, rules = pcall(dofile, path)
	if not ok or type(rules) ~= "table" then
		return cache
	end

	for _, rule in ipairs(rules) do
		if type(rule) == "table" and type(rule.effects) == "table" then
			local matcher, pattern = rule_identity(rule)
			local size = rule.effects.size
			local move = rule.effects.move
			if matcher and pattern and type(size) == "table" and type(move) == "table" then
				cache[cache_key(matcher, pattern)] = cache_entry(
					matcher,
					pattern,
					rule.effects.monitor or "",
					move[1],
					move[2],
					size[1],
					size[2]
				)
			end
		end
	end

	return cache
end

function M.prune_rules_cache(cache, selectors)
	local valid = {}
	for _, selector in ipairs(selectors) do
		valid[cache_key(selector.matcher, selector.pattern)] = true
	end

	for key in pairs(cache) do
		if not valid[key] then
			cache[key] = nil
		end
	end
end

local function sorted_cache_keys(cache)
	local keys = {}
	for key in pairs(cache) do
		keys[#keys + 1] = key
	end
	table.sort(keys)
	return keys
end

local function render_rules(cache, selectors_path)
	local lines = {
		"-- Auto-generated Lua window state persistence rules",
		"-- Selectors: " .. selectors_path,
		"-- DO NOT EDIT MANUALLY - This file is managed by window-state.sh",
		"",
		"return {",
	}

	for _, key in ipairs(sorted_cache_keys(cache)) do
		local entry = cache[key]
		local lua_match_key = M.matcher_lua_key(entry.matcher)
		if lua_match_key then
			lines[#lines + 1] = "  -- " .. key
			lines[#lines + 1] = "  {"
			lines[#lines + 1] = "    id = " .. json.encode(rule_id(entry.matcher, entry.pattern)) .. ","
			lines[#lines + 1] = "    matcher = " .. json.encode(entry.matcher) .. ","
			lines[#lines + 1] = "    pattern = " .. json.encode(entry.pattern) .. ","
			lines[#lines + 1] = "    match = {"
			lines[#lines + 1] = "      " .. lua_match_key .. " = " .. json.encode(rule_pattern(entry.pattern)) .. ","
			lines[#lines + 1] = "    },"
			lines[#lines + 1] = "    effects = {"
			if entry.monitor and entry.monitor ~= "" then
				lines[#lines + 1] = "      monitor = " .. json.encode(entry.monitor) .. ","
			end
			lines[#lines + 1] = "      size = { " .. entry.width .. ", " .. entry.height .. " },"
			lines[#lines + 1] = "      move = { " .. entry.x .. ", " .. entry.y .. " },"
			lines[#lines + 1] = "    },"
			lines[#lines + 1] = "    source = \"window-state\","
			lines[#lines + 1] = "    comment = " .. json.encode(key) .. ","
			lines[#lines + 1] = "  },"
			lines[#lines + 1] = ""
		end
	end

	lines[#lines + 1] = "}"
	lines[#lines + 1] = ""
	return table.concat(lines, "\n")
end

function M.write_rules_file(opts)
	local rules_dir = opts.config_dir .. "/rules"
	os.execute("mkdir -p " .. shell_quote(rules_dir))
	local temp = temp_path_in(rules_dir, ".window-state")
	local next_content = render_rules(opts.cache, opts.selectors_lua_file)

	local handle = assert(io.open(temp, "w"))
	handle:write(next_content)
	handle:close()

	local existing = read_file(opts.rules_lua_file)
	if existing == next_content then
		os.remove(temp)
		return false
	end

	assert(os.rename(temp, opts.rules_lua_file))
	return true
end

function M.update_cache_from_windows(cache, windows, log)
	for window in iter_state_objects(windows) do
		if window.class and window.class ~= "" then
			cache[cache_key(window.matcher, window.pattern)] = cache_entry(
				window.matcher,
				window.pattern,
				window.monitor or "",
				window.x,
				window.y,
				window.width,
				window.height
			)
			log(string.format(
				'Updated %s "%s": %sx%s at (%s,%s) on %s',
				window.matcher,
				window.pattern,
				window.width,
				window.height,
				window.x,
				window.y,
				window.monitor ~= "" and window.monitor or "unknown"
			))
		end
	end
end

return M
