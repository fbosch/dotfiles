local json = require("lib.json")

local M = {}
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

local function validate(state)
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

function M.path()
	return (os.getenv("XDG_RUNTIME_DIR") or "/tmp") .. "/hypr-profiles/state.json"
end

function M.read(path)
	local file = io.open(path or M.path(), "r")
	if not file then
		fail("cannot read " .. (path or M.path()))
	end

	local contents = file:read("*a")
	file:close()
	if #contents > 65536 then
		fail("state exceeds 65536 bytes")
	end

	local state = json.decode(contents)
	validate(state)
	return state
end

function M.resolved(path)
	return M.read(path).resolved
end

function M.encode(generation, selection, resolved, source_claims)
	local state = json.new_object()
	state.generation = generation
	state.selection = selection
	state.resolved = resolved
	state.sources = json.new_object()

	for _, profile in ipairs({ "gaming", "powersave" }) do
		state.sources[profile] = json.new_object()
		for source, count in pairs(source_claims[profile] or {}) do
			state.sources[profile][source] = count
		end
	end

	validate(state)
	local encoded = json.encode(state)
	if #encoded > 65536 then
		fail("state exceeds 65536 bytes")
	end

	return encoded
end

function M.is_profile(value)
	return valid_profiles[value] == true
end

function M.is_source(value)
	return type(value) == "string" and value:match("^[a-z][a-z0-9_-]*$") ~= nil
end

return M
