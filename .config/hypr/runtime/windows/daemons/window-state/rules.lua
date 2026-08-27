local json = require("lib.json")
local command = require("lib.command")
local generated_rules = require("lib.generated_rules")
local pip = require("lib.picture_in_picture")

local M = {}

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
	local command_line = "mktemp " .. command.arg(directory .. "/" .. prefix .. ".XXXXXX")
	local handle = assert(io.popen(command_line, "r"))
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

local function valid_persist_tags(tags)
	if tags == nil then
		return true
	end
	if type(tags) ~= "table" or #tags == 0 then
		return false
	end

	local seen = {}
	for _, tag in ipairs(tags) do
		if type(tag) ~= "string" or tag == "" or tag:sub(-1) == "*" or seen[tag] then
			return false
		end
		seen[tag] = true
	end

	return true
end

local function valid_persist_tag_animations(animations, tags)
	if animations == nil then
		return true
	end
	if type(animations) ~= "table" or type(tags) ~= "table" then
		return false
	end

	local allowed = {}
	for _, tag in ipairs(tags) do
		allowed[tag] = true
	end
	for tag, animation in pairs(animations) do
		if type(tag) ~= "string" or type(animation) ~= "string" or animation == "" or allowed[tag] ~= true then
			return false
		end
	end

	return true
end

function M.load_selectors(path)
	local ok, selectors = pcall(dofile, path)
	local normalized = {}
	local matchers = {}
	local geometry_authority_seen = false

	if not ok or type(selectors) ~= "table" then
		return {
			selectors = normalized,
			matchers_json = "[]",
		}
	end

	for _, selector in ipairs(selectors) do
		if type(selector) == "table" and type(selector.matcher) == "string" and type(selector.pattern) == "string" then
			local field = M.matcher_client_field(selector.matcher)
			local exclude = selector.exclude
			local persist_tags = selector.persist_tags
			local persist_tag_animations = selector.persist_tag_animations
			local geometry_authority = selector.geometry_authority
			local per_monitor = selector.per_monitor
			local restore_monitor = selector.restore_monitor
			local restore_size = selector.restore_size
			local valid_geometry_authority = geometry_authority == nil
				or (
					geometry_authority == "pip"
					and geometry_authority_seen == false
					and selector.matcher == "match:initial_title"
					and selector.pattern == "^" .. pip.title .. "$"
					and per_monitor == false
					and restore_monitor == true
					and restore_size == false
				)
			local valid_exclude = exclude == nil
				or (
					type(exclude) == "table"
					and type(exclude.matcher) == "string"
					and type(exclude.patterns) == "table"
					and #exclude.patterns > 0
					and M.matcher_client_field(exclude.matcher) ~= nil
				)
			if valid_exclude and exclude then
				for _, pattern in ipairs(exclude.patterns) do
					if type(pattern) ~= "string" then
						valid_exclude = false
						break
					end
				end
			end
			if
				field
				and valid_exclude
				and valid_persist_tags(persist_tags)
				and valid_persist_tag_animations(persist_tag_animations, persist_tags)
				and valid_geometry_authority
				and (per_monitor == nil or type(per_monitor) == "boolean")
				and (restore_monitor == nil or type(restore_monitor) == "boolean")
				and (restore_monitor ~= true or per_monitor == false)
				and (restore_size == nil or type(restore_size) == "boolean")
			then
				normalized[#normalized + 1] = {
					matcher = selector.matcher,
					pattern = selector.pattern,
					exclude = exclude,
					persist_tags = persist_tags,
					persist_tag_animations = persist_tag_animations,
					geometry_authority = geometry_authority,
					per_monitor = per_monitor ~= false,
					restore_monitor = restore_monitor == true,
					restore_size = restore_size ~= false,
				}
				matchers[#matchers + 1] = {
					matcher = selector.matcher,
					pattern = selector.pattern,
					field = field,
				}
				geometry_authority_seen = geometry_authority_seen or geometry_authority == "pip"
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

local function rule_id(matcher, pattern, monitor)
	return "window-state:" .. matcher .. ":" .. pattern .. ":" .. (monitor ~= "" and monitor or "global")
end

local function cache_key(matcher, pattern, monitor)
	return string.format("%d:%s%d:%s%d:%s", #matcher, matcher, #pattern, pattern, #monitor, monitor)
end

local function cache_entry(matcher, pattern, monitor, x, y, width, height, tags, target_monitor, placement)
	return {
		matcher = matcher,
		pattern = pattern,
		monitor = monitor,
		x = tonumber(x),
		y = tonumber(y),
		width = tonumber(width),
		height = tonumber(height),
		tags = tags,
		target_monitor = target_monitor,
		placement = placement,
	}
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
			local width, height = generated_rules.parse_pair(rule.effects.size)
			local x, y = generated_rules.parse_pair(rule.effects.move)
			local target_monitor = rule.target_monitor
			local monitor = rule.monitor or (target_monitor == nil and rule.effects.monitor) or ""
			local placement = pip.acceptance.normalize(rule.placement)
			local valid_size = (width ~= nil and height ~= nil) or (width == nil and height == nil)
			if matcher and pattern and valid_size and ((x and y) or placement) then
				cache[cache_key(matcher, pattern, monitor)] =
					cache_entry(matcher, pattern, monitor, x, y, width, height, rule.tags, target_monitor, placement)
			end
		end
	end

	return cache
end

local function corner_from_tags(tags)
	if type(tags) ~= "table" then
		return nil
	end

	for corner, definition in pairs(pip.corners) do
		for _, tag in ipairs(tags) do
			if tag == definition.tag then
				return corner
			end
		end
	end
end

function M.migrate_geometry_authorities(cache, selectors)
	local authorities = {}
	for _, selector in ipairs(selectors) do
		if selector.geometry_authority == "pip" then
			authorities[cache_key(selector.matcher, selector.pattern, "")] = true
		end
	end

	local changed = false
	for _, entry in pairs(cache) do
		local identity = cache_key(entry.matcher, entry.pattern, "")
		if
			authorities[identity]
			and entry.placement == nil
			and type(entry.target_monitor) == "string"
			and entry.target_monitor ~= ""
		then
			local corner = corner_from_tags(entry.tags)
			if corner then
				entry.placement = {
					kind = "corner",
					corner = corner,
					target_monitor = entry.target_monitor,
				}
				entry.x = nil
				entry.y = nil
				changed = true
			elseif entry.x and entry.y then
				entry.placement = {
					kind = "free",
					target_monitor = entry.target_monitor,
					x = entry.x,
					y = entry.y,
				}
				changed = true
			end
		end
	end

	return changed
end

function M.accept_pip_placement(cache, selectors, value)
	local placement, err = pip.acceptance.normalize(value)
	if placement == nil then
		return nil, err
	end

	local authority
	for _, selector in ipairs(selectors) do
		if selector.geometry_authority == "pip" then
			if authority then
				return nil, "multiple PiP geometry authority selectors"
			end
			authority = selector
		end
	end
	if authority == nil then
		return nil, "missing PiP geometry authority selector"
	end

	local monitor = authority.per_monitor and placement.target_monitor or ""
	local tags
	local x
	local y
	if placement.kind == "corner" then
		tags = { pip.corners[placement.corner].tag }
	else
		x = placement.x
		y = placement.y
	end
	cache[cache_key(authority.matcher, authority.pattern, monitor)] = cache_entry(
		authority.matcher,
		authority.pattern,
		monitor,
		x,
		y,
		nil,
		nil,
		tags,
		placement.target_monitor,
		placement
	)
	return true
end

function M.prune_rules_cache(cache, selectors)
	local valid = {}
	for _, selector in ipairs(selectors) do
		valid[cache_key(selector.matcher, selector.pattern, "")] = selector
	end

	for key, entry in pairs(cache) do
		local selector = valid[cache_key(entry.matcher, entry.pattern, "")]
		local global = entry.monitor == ""
		local per_monitor = selector and selector.per_monitor ~= false
		if not selector or global == per_monitor then
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

local function persisted_tags(entry, selector)
	if type(entry.tags) ~= "table" or type(selector and selector.persist_tags) ~= "table" then
		return {}
	end

	local saved = {}
	for _, tag in ipairs(entry.tags) do
		if type(tag) == "string" then
			saved[tag] = true
		end
	end

	local tags = {}
	for _, tag in ipairs(selector.persist_tags) do
		if saved[tag] then
			tags[1] = tag
			break
		end
	end

	return tags
end

local function lua_array(values)
	local encoded = {}
	for _, value in ipairs(values) do
		encoded[#encoded + 1] = json.encode(value)
	end
	return "{ " .. table.concat(encoded, ", ") .. " }"
end

local function append_match(lines, entry, selector, lua_match_key)
	lines[#lines + 1] = "    match = {"
	lines[#lines + 1] = "      " .. lua_match_key .. " = " .. json.encode(rule_pattern(entry.pattern)) .. ","
	if selector and selector.exclude then
		local exclude_match_key = M.matcher_lua_key(selector.exclude.matcher)
		if exclude_match_key then
			local exclude_patterns = {}
			for _, pattern in ipairs(selector.exclude.patterns) do
				exclude_patterns[#exclude_patterns + 1] = rule_pattern(pattern)
			end
			lines[#lines + 1] = "      "
				.. exclude_match_key
				.. " = "
				.. json.encode("negative:(" .. table.concat(exclude_patterns, "|") .. ")")
				.. ","
		end
	end
	if entry.monitor ~= "" then
		lines[#lines + 1] = "      workspace = " .. json.encode("m[" .. entry.monitor .. "]") .. ","
	end
	lines[#lines + 1] = "    },"
end

local function placement_literal(placement)
	if placement.kind == "corner" then
		return string.format(
			"{ kind = %s, corner = %s, target_monitor = %s }",
			json.encode(placement.kind),
			json.encode(placement.corner),
			json.encode(placement.target_monitor)
		)
	end

	return string.format(
		"{ kind = %s, target_monitor = %s, x = %s, y = %s }",
		json.encode(placement.kind),
		json.encode(placement.target_monitor),
		tostring(placement.x),
		tostring(placement.y)
	)
end

local function append_rule_identity(lines, entry, id, include_placement)
	lines[#lines + 1] = "  {"
	lines[#lines + 1] = "    id = " .. json.encode(id) .. ","
	lines[#lines + 1] = "    matcher = " .. json.encode(entry.matcher) .. ","
	lines[#lines + 1] = "    pattern = " .. json.encode(entry.pattern) .. ","
	if entry.monitor ~= "" then
		lines[#lines + 1] = "    monitor = " .. json.encode(entry.monitor) .. ","
	end
	if entry.target_monitor then
		lines[#lines + 1] = "    target_monitor = " .. json.encode(entry.target_monitor) .. ","
	end
	if include_placement and entry.placement then
		lines[#lines + 1] = "    placement = " .. placement_literal(entry.placement) .. ","
	end
end

local function render_rules(cache, selectors_path, selectors)
	local selectors_by_identity = {}
	for _, selector in ipairs(selectors or {}) do
		selectors_by_identity[cache_key(selector.matcher, selector.pattern, "")] = selector
	end

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
		local selector = selectors_by_identity[cache_key(entry.matcher, entry.pattern, "")]
		if lua_match_key then
			local scope = entry.monitor ~= "" and " on " .. entry.monitor or " globally"
			local comment = entry.matcher .. " " .. entry.pattern .. scope
			lines[#lines + 1] = "  -- " .. entry.matcher .. " " .. entry.pattern .. scope
			local tags = persisted_tags(entry, selector)
			append_rule_identity(lines, entry, rule_id(entry.matcher, entry.pattern, entry.monitor), true)
			append_match(lines, entry, selector, lua_match_key)
			lines[#lines + 1] = "    effects = {"
			lines[#lines + 1] = '      fullscreen_state = "0 0",'
			if (selector == nil or selector.restore_size ~= false) and entry.width and entry.height then
				lines[#lines + 1] = "      size = "
					.. json.encode(generated_rules.format_pair(entry.width, entry.height))
					.. ","
			end
			if entry.x and entry.y then
				lines[#lines + 1] = "      move = " .. json.encode(generated_rules.format_pair(entry.x, entry.y)) .. ","
			end
			if entry.target_monitor then
				lines[#lines + 1] = "      monitor = " .. json.encode(entry.target_monitor) .. ","
			end
			if #tags > 0 then
				lines[#lines + 1] = "      tag = " .. json.encode("+" .. tags[1]) .. ","
			end
			lines[#lines + 1] = "    },"
			if #tags > 0 then
				lines[#lines + 1] = "    tags = " .. lua_array(tags) .. ","
			end
			lines[#lines + 1] = '    source = "window-state",'
			lines[#lines + 1] = "    comment = " .. json.encode(comment) .. ","
			lines[#lines + 1] = "  },"
			lines[#lines + 1] = ""

			for _, tag in ipairs(tags) do
				local animation = selector.persist_tag_animations and selector.persist_tag_animations[tag]
				if animation then
					append_rule_identity(
						lines,
						entry,
						rule_id(entry.matcher, entry.pattern, entry.monitor) .. ":animation:" .. tag,
						false
					)
					append_match(lines, entry, selector, lua_match_key)
					lines[#lines + 1] = "    effects = {"
					lines[#lines + 1] = "      animation = " .. json.encode(animation) .. ","
					lines[#lines + 1] = "    },"
					lines[#lines + 1] = '    source = "window-state",'
					lines[#lines + 1] = "    comment = " .. json.encode(comment .. " animation " .. tag) .. ","
					lines[#lines + 1] = "  },"
					lines[#lines + 1] = ""
				end
			end

			for _, tag in ipairs((selector and selector.persist_tags) or {}) do
				if tag ~= tags[1] then
					append_rule_identity(
						lines,
						entry,
						rule_id(entry.matcher, entry.pattern, entry.monitor) .. ":tag-cleanup:" .. tag,
						false
					)
					append_match(lines, entry, selector, lua_match_key)
					lines[#lines + 1] = "    effects = {"
					lines[#lines + 1] = "      tag = " .. json.encode("-" .. tag) .. ","
					lines[#lines + 1] = "    },"
					lines[#lines + 1] = '    source = "window-state",'
					lines[#lines + 1] = "    comment = " .. json.encode(comment .. " tag cleanup " .. tag) .. ","
					lines[#lines + 1] = "  },"
					lines[#lines + 1] = ""
				end
			end
		end
	end

	lines[#lines + 1] = "}"
	lines[#lines + 1] = ""
	return table.concat(lines, "\n")
end

function M.write_rules_file(opts)
	local next_content = render_rules(opts.cache, opts.selectors_lua_file, opts.selectors)

	local existing = read_file(opts.rules_lua_file)
	if existing == next_content then
		return false
	end

	local rules_dir = opts.config_dir .. "/rules"
	command.ok("mkdir -p " .. command.arg(rules_dir) .. " >/dev/null 2>&1")
	local temp = temp_path_in(rules_dir, ".window-state")
	local handle = assert(io.open(temp, "w"))
	local written, write_err = handle:write(next_content)
	if written == nil then
		handle:close()
		os.remove(temp)
		error(write_err or "failed to write generated rules")
	end
	local closed, close_err = handle:close()
	if closed == nil then
		os.remove(temp)
		error(close_err or "failed to close generated rules")
	end
	local renamed, rename_err = os.rename(temp, opts.rules_lua_file)
	if renamed == nil then
		os.remove(temp)
		error(rename_err or "failed to replace generated rules")
	end
	return true
end

function M.update_cache_from_windows(cache, windows, log, selectors)
	local geometry_authorities = {}
	for _, selector in ipairs(selectors or {}) do
		if selector.geometry_authority ~= nil then
			geometry_authorities[cache_key(selector.matcher, selector.pattern, "")] = true
		end
	end

	for _, window in ipairs(json.array(windows)) do
		local identity = cache_key(window.matcher or "", window.pattern or "", "")
		if geometry_authorities[identity] == nil and window.class and window.class ~= "" and window.monitor ~= nil then
			cache[cache_key(window.matcher, window.pattern, window.monitor)] = cache_entry(
				window.matcher,
				window.pattern,
				window.monitor or "",
				window.x,
				window.y,
				window.width,
				window.height,
				window.tags,
				window.target_monitor,
				nil
			)
			if log then
				log(
					string.format(
						'Updated %s "%s": %sx%s at (%s,%s) on %s',
						window.matcher,
						window.pattern,
						window.width,
						window.height,
						window.x,
						window.y,
						window.monitor ~= "" and window.monitor or "global"
					)
				)
			end
		end
	end
end

return M
