local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/window_state_publication_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local json = require("lib.json")
local publication = require("runtime.windows.daemons.window-state.publication")

local function read_file(path)
	local handle = io.open(path, "r")
	if not handle then
		return nil
	end
	local content = handle:read("*a")
	handle:close()
	return content
end

local function saved_window(class, monitor, x)
	return {
		class = class,
		matcher = "match:class",
		pattern = "^" .. class .. "$",
		monitor = monitor,
		x = x,
		y = 20,
		width = 300,
		height = 400,
	}
end

local function selector(class)
	return {
		matcher = "match:class",
		pattern = "^" .. class .. "$",
		per_monitor = true,
	}
end

describe("window-state publication", function()
	local temp_dir
	local state_path
	local rules_path
	local reload_calls
	local reload_result
	local logs
	local state_writes
	local kit
	local publisher

	local function new_publisher()
		return publication.new({
			kit = kit,
			config_dir = temp_dir,
			reload = function()
				reload_calls = reload_calls + 1
				return reload_result
			end,
			log = function(message)
				logs[#logs + 1] = message
			end,
		})
	end

	before_each(function()
		temp_dir = os.tmpname()
		os.remove(temp_dir)
		state_path = temp_dir .. "/window-state.cache"
		rules_path = temp_dir .. "/rules/window-state.lua"
		reload_calls = 0
		reload_result = true
		logs = {}
		state_writes = 0
		kit = {
			instance_path = function(_, name)
				return temp_dir .. "/" .. name
			end,
			write_shared_file = function(_, path, content)
				state_writes = state_writes + 1
				local handle = assert(io.open(path, "w"))
				handle:write(content)
				handle:close()
			end,
		}
		publisher = new_publisher()
	end)

	after_each(function()
		os.execute("rm -rf " .. string.format("%q", temp_dir))
	end)

	it("publishes captured state and reloads only when generated rules change", function()
		local selectors = { selector("Test") }
		local snapshot = json.encode({ saved_window("Test", "DP-1", 10) })

		assert.is_true(publisher:publish(snapshot, selectors))
		assert.are.equal(snapshot .. "\n", read_file(state_path))
		assert.is_truthy(read_file(rules_path):find('class = "^Test$"', 1, true))
		assert.are.equal(1, reload_calls)

		assert.is_false(publisher:publish(snapshot, selectors))
		assert.are.equal(2, state_writes)
		assert.are.equal(1, reload_calls)
	end)

	it("reconciles generated rules when selectors are removed", function()
		local test_selector = selector("Test")
		local other_selector = selector("Other")
		local snapshot = json.encode({
			saved_window("Test", "DP-1", 10),
			saved_window("Other", "DP-1", 30),
		})

		assert.is_true(publisher:publish(snapshot, { test_selector, other_selector }))
		assert.is_true(publisher:reconcile({ test_selector }))
		local rules = read_file(rules_path)
		assert.is_truthy(rules:find('class = "^Test$"', 1, true))
		assert.is_nil(rules:find('class = "^Other$"', 1, true))
		assert.are.equal(2, reload_calls)

		assert.is_false(publisher:reconcile({ test_selector }))
		assert.are.equal(2, reload_calls)
	end)

	it("logs reload failures after publishing files", function()
		reload_result = false
		local snapshot = json.encode({ saved_window("Test", "DP-1", 10) })

		assert.is_true(publisher:publish(snapshot, { selector("Test") }))
		assert.are.equal(snapshot .. "\n", read_file(state_path))
		assert.is_not_nil(read_file(rules_path))
		assert.are.same({ "WARNING: Failed to refresh window-state rules" }, logs)
	end)

	it("propagates state publication failures before reloading", function()
		kit.write_shared_file = function()
			error("state write failed")
		end
		publisher = new_publisher()

		local ok, err = pcall(function()
			publisher:publish(json.encode({ saved_window("Test", "DP-1", 10) }), { selector("Test") })
		end)
		assert.is_false(ok)
		assert.is_truthy(tostring(err):find("state write failed", 1, true))
		assert.are.equal(0, reload_calls)
		assert.is_not_nil(read_file(rules_path))
	end)

	it("ignores empty captured state", function()
		assert.is_false(publisher:publish("[]", { selector("Test") }))
		assert.are.equal(0, state_writes)
		assert.are.equal(0, reload_calls)
		assert.is_nil(read_file(rules_path))
	end)
end)
