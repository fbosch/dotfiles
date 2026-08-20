local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/order_state_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local order_state = require("layouts.shared.order_state")

local function target(address)
	return { window = { address = address } }
end

local function assert_sync_failure_preserves_state(targets)
	local state = order_state.new()
	local existing = target("0xexisting")
	state.order_by_key.workspace = { "address:0xexisting" }
	state.target_maps_by_key.workspace = { ["address:0xexisting"] = existing }
	state.seen_ids["address:0xexisting"] = true

	local order, targets_by_id = order_state.sync(state, "workspace", targets)

	assert.is_nil(order)
	assert.is_nil(targets_by_id)
	assert.are.same({ "address:0xexisting" }, state.order_by_key.workspace)
	assert.are.same({ ["address:0xexisting"] = existing }, state.target_maps_by_key.workspace)
	assert.is_true(state.seen_ids["address:0xexisting"])
	assert.is_nil(state.seen_ids["address:0xvalid"])
end

describe("custom layout order state", function()
	it("prefers window addresses over stable identities", function()
		local window = { address = "0xaddress", stable_id = 42 }

		assert.are.equal("address:0xaddress", order_state.target_id({ window = window }))
		assert.are.equal("address:0xaddress", order_state.window_id(window))
	end)

	it("finds a target by its captured identity", function()
		local targets = { target("0xfirst"), target("0xsecond") }

		assert.are.equal(2, order_state.target_index(targets, "address:0xsecond"))
		assert.is_nil(order_state.target_index(targets, "address:0xmissing"))
	end)

	it("does not mutate state when a target identity is missing", function()
		assert_sync_failure_preserves_state({ target("0xvalid"), { window = {} } })
	end)

	it("does not mutate state when target identities are duplicated", function()
		assert_sync_failure_preserves_state({ target("0xvalid"), target("0xvalid") })
	end)
end)
