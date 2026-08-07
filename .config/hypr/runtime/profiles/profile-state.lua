#!/usr/bin/env luajit

local script_dir = arg[0]:match("^(.*)/[^/]+$") or "."
package.path = script_dir .. "/../../?.lua;" .. package.path

local json = require("lib.json")

local max_integer = 2147483647
local valid_profiles = {
	default = true,
	gaming = true,
	powersave = true,
}
local valid_selections = {
	auto = true,
	default = true,
	gaming = true,
	powersave = true,
}

local function fail(message)
	error("profile-state: " .. message, 0)
end

local function is_integer(value)
	return type(value) == "number" and value >= 0 and value <= max_integer and math.floor(value) == value
end

local function has_exact_keys(value, expected)
	if not json.is_object(value) then
		return false
	end

	for key in pairs(value) do
		if expected[key] ~= true then
			return false
		end
	end

	for key in pairs(expected) do
		if value[key] == nil then
			return false
		end
	end

	return true
end

local function valid_source_claims(value)
	if not json.is_object(value) then
		return false
	end

	for source, count in pairs(value) do
		if type(source) ~= "string" or not source:match("^[a-z][a-z0-9_-]*$") or not is_integer(count) then
			return false
		end
	end

	return true
end

local function has_active_claim(value)
	for _, count in pairs(value) do
		if count > 0 then
			return true
		end
	end

	return false
end

local function expected_resolved_profile(state)
	if state.selection ~= "auto" then
		return state.selection
	end

	if has_active_claim(state.sources.gaming) then
		return "gaming"
	end

	if has_active_claim(state.sources.powersave) then
		return "powersave"
	end

	return "default"
end

local function validate_state(state)
	if
		not has_exact_keys(state, {
			generation = true,
			selection = true,
			resolved = true,
			sources = true,
		})
	then
		fail("invalid state fields")
	end

	if not is_integer(state.generation) then
		fail("invalid generation")
	end

	if valid_selections[state.selection] ~= true then
		fail("invalid selection")
	end

	if valid_profiles[state.resolved] ~= true then
		fail("invalid profile")
	end

	if
		not has_exact_keys(state.sources, { gaming = true, powersave = true })
		or not valid_source_claims(state.sources.gaming)
		or not valid_source_claims(state.sources.powersave)
	then
		fail("invalid source claims")
	end

	if state.resolved ~= expected_resolved_profile(state) then
		fail("inconsistent profile state")
	end
end

local function read_state(path)
	local file = io.open(path, "r")
	if not file then
		fail("cannot read " .. path)
	end

	local contents = file:read("*a")
	file:close()
	if #contents > 65536 then
		fail("state exceeds 65536 bytes")
	end

	local state = json.decode(contents)
	validate_state(state)
	return state
end

local function encode_state(generation, selection, resolved)
	if not is_integer(generation) then
		fail("invalid generation")
	end

	local state = json.new_object()
	state.generation = generation
	state.selection = selection
	state.resolved = resolved
	state.sources = json.new_object()
	state.sources.gaming = json.new_object()
	state.sources.powersave = json.new_object()

	for line in io.lines() do
		local profile, source, count = line:match("^([^\t]+)\t([^\t]+)\t([^\t]+)$")
		if not profile or not source or not count then
			fail("invalid source claim")
		end

		if valid_profiles[profile] ~= true or profile == "default" then
			fail("invalid source profile")
		end

		local numeric_count = tonumber(count)
		if not numeric_count then
			fail("invalid source count")
		end

		state.sources[profile][source] = numeric_count
	end

	validate_state(state)
	local encoded = json.encode(state)
	if #encoded > 65536 then
		fail("state exceeds 65536 bytes")
	end

	return encoded
end

local function main()
	if arg[1] == "generation" and arg[2] then
		io.write(read_state(arg[2]).generation)
		return
	end

	if arg[1] == "source-count" and arg[2] and arg[3] and arg[4] then
		local state = read_state(arg[2])
		if valid_profiles[arg[3]] ~= true or arg[3] == "default" then
			fail("invalid source profile")
		end

		if not arg[4]:match("^[a-z][a-z0-9_-]*$") then
			fail("invalid source name")
		end

		io.write(state.sources[arg[3]][arg[4]] or 0)
		return
	end

	if arg[1] == "encode" and arg[2] and arg[3] and arg[4] then
		local written, write_error = io.write(encode_state(tonumber(arg[2]), arg[3], arg[4]))
		if not written then
			fail("cannot write state: " .. tostring(write_error))
		end

		local flushed, flush_error = io.flush()
		if not flushed then
			fail("cannot flush state: " .. tostring(flush_error))
		end
		return
	end

	fail("usage: profile-state.lua <generation|source-count|encode> ...")
end

local ok, error_message = pcall(main)
if ok == false then
	io.stderr:write(tostring(error_message), "\n")
	os.exit(1)
end
