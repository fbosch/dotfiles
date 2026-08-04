local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/persistent_state_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local persistent_state = require("layouts.shared.persistent_state")

local function assert_equal(actual, expected, message)
	if actual ~= expected then
		error(string.format("%s: expected %s, got %s", message, tostring(expected), tostring(actual)), 2)
	end
end

local function temporary_path()
	local path = os.tmpname()
	os.remove(path)
	os.remove(path .. ".tmp")
	return path
end

local function read_file(path)
	local handle = assert(io.open(path, "r"))
	local value = handle:read("*a")
	handle:close()
	return value
end

local function write_file(path, value)
	local handle = assert(io.open(path, "w"))
	handle:write(value)
	handle:close()
end

after_each(function()
	if _G.persistent_state_test_path then
		os.remove(_G.persistent_state_test_path)
		os.remove(_G.persistent_state_test_path .. ".tmp")
		_G.persistent_state_test_path = nil
	end
end)

it("writes through a temporary file before replacing state", function()
	local path = temporary_path()
	_G.persistent_state_test_path = path
	local opened_destination = false
	local original_open = io.open
	io.open = function(open_path, mode, ...)
		if open_path == path and mode == "w" then
			opened_destination = true
		end

		return original_open(open_path, mode, ...)
	end

	local ok, err = pcall(persistent_state.save, path, {
		{ kind = "rows", values = { workspace = { 0.4, 0.6 } } },
	}, {
		workspace = { "stable:1", "stable:2" },
	})
	io.open = original_open
	if ok == false then
		error(err, 0)
	end

	assert_equal(opened_destination, false, "opened destination directly")
	assert_equal(io.open(path .. ".tmp", "r"), nil, "temporary file remains")

	local ratios, orders = {}, {}
	persistent_state.load(path, { rows = ratios }, orders)
	assert_equal(ratios.workspace[1], 0.4, "saved first ratio")
	assert_equal(ratios.workspace[2], 0.6, "saved second ratio")
	assert_equal(orders.workspace[2], "stable:2", "saved order")
end)

it("retains the existing state when replacement fails", function()
	local path = temporary_path()
	_G.persistent_state_test_path = path
	persistent_state.save(path, {
		{ kind = "rows", values = { workspace = { 0.4, 0.6 } } },
	}, {})
	local before = read_file(path)

	local original_rename = os.rename
	os.rename = function()
		return nil, "simulated rename failure"
	end
	local ok, err = pcall(persistent_state.save, path, {
		{ kind = "rows", values = { workspace = { 0.2, 0.8 } } },
	}, {})
	os.rename = original_rename
	if ok == false then
		error(err, 0)
	end

	assert_equal(read_file(path), before, "state after replacement failure")
	assert_equal(io.open(path .. ".tmp", "r"), nil, "temporary file after replacement failure")
end)

it("rejects invalid ratios while retaining valid and legacy records", function()
	local path = temporary_path()
	_G.persistent_state_test_path = path
	write_file(path, table.concat({
		"rows\tvalid\t2\t0.4,0.6",
		"legacy\t2\t0.5,0.5",
		"rows\tnegative\t2\t-0.2,1.2",
		"rows\tzero\t2\t0,1",
		"rows\tnan\t2\tnan,0.5",
		"rows\tinfinity\t2\t1e309,0.5",
		"rows\tnormalized\t2\t0.7,0.7",
		"order\tvalid\t2\tstable%3A1,stable%3A2",
	}, "\n") .. "\n")

	local ratios = { negative = { 0.3, 0.7 } }
	local orders = {}
	persistent_state.load(path, { rows = ratios }, orders, "rows")

	assert_equal(ratios.valid[1], 0.4, "valid ratio")
	assert_equal(ratios.legacy[2], 0.5, "legacy ratio")
	assert_equal(ratios.negative[1], 0.3, "existing invalid-ratio state")
	assert_equal(ratios.zero, nil, "zero ratio record")
	assert_equal(ratios.nan, nil, "nan ratio record")
	assert_equal(ratios.infinity, nil, "infinite ratio record")
	assert_equal(ratios.normalized, nil, "non-normalized ratio record")
	assert_equal(orders.valid[2], "stable:2", "order record")
end)
