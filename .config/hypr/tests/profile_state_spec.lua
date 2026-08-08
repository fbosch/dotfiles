local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/profile_state_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local profile_state = require("lib.profile_state")

local function write_file(path, value)
	local handle = assert(io.open(path, "w"))
	handle:write(value)
	handle:close()
end

local function temporary_path()
	local path = os.tmpname()
	os.remove(path)
	return path
end

after_each(function()
	if _G.profile_state_test_path then
		os.remove(_G.profile_state_test_path)
		_G.profile_state_test_path = nil
	end
end)

it("reads a validated canonical resolved profile", function()
	local path = temporary_path()
	_G.profile_state_test_path = path
	write_file(
		path,
		'{"generation":2,"resolved":"gaming","selection":"auto","sources":{"gaming":{"watchdog":1},"powersave":{}}}'
	)

	assert.are.equal("gaming", profile_state.resolved(path))
	assert.are.equal(2, profile_state.read(path).generation)
end)

it("rejects contradictory canonical state", function()
	local path = temporary_path()
	_G.profile_state_test_path = path
	write_file(
		path,
		'{"generation":2,"resolved":"default","selection":"auto","sources":{"gaming":{"watchdog":1},"powersave":{}}}'
	)

	assert.is_false(pcall(profile_state.read, path))
end)
