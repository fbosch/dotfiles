local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/daemon_kit_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local daemon = require("runtime.lib.daemon")

local function assert_equal(actual, expected, message)
	if actual ~= expected then
		error(string.format("%s: expected %s, got %s", message, tostring(expected), tostring(actual)), 2)
	end
end

local function fake_transport(monitors_response, clients_response)
	local request_calls = 0
	local transport
	transport = {
		call_count = function()
			return request_calls
		end,
		request = function(message)
			request_calls = request_calls + 1
			if message == "j/monitors" then
				return monitors_response
			elseif message == "j/clients" then
				return clients_response
			end
			return ""
		end,
		connect_event_socket = function()
			error("event socket not expected in this test")
		end,
		socket_path = function(name)
			return "/fake/socket.sock"
		end,
		instance_path = function(name)
			return "/fake/" .. name
		end,
		assert_socket_connects = function() end,
	}
	return transport
end

it("normalizes monitor geometry including rotated displays", function()
	local transport = fake_transport(
		'[{"id":7,"name":"DP-2","x":0,"y":0,"width":3440,"height":1440,"transform":0},{"id":8,"name":"HDMI-A-2","x":3440,"y":0,"width":1080,"height":1920,"transform":3}]',
		"[]"
	)
	local kit = daemon.new({ transport = transport })
	local monitors = kit:monitors()

	assert_equal(#monitors, 2, "monitor count")
	assert_equal(monitors[1].id, "7", "ultrawide id as string")
	assert_equal(monitors[1].width, 3440, "unrotated width")
	assert_equal(monitors[2].width, 1920, "rotated width swaps dimensions")
	assert_equal(monitors[2].height, 1080, "rotated height swaps dimensions")
end)

it("caches monitor queries until the TTL expires or a refresh is forced", function()
	local transport = fake_transport("[]", "[]")
	local kit = daemon.new({ transport = transport })

	kit:monitors()
	kit:monitors()
	assert_equal(transport:call_count(), 1, "cached query count")

	kit:monitors({ force = true })
	assert_equal(transport:call_count(), 2, "forced refresh query count")
end)

it("returns the previous monitor list when the query fails", function()
	local transport = fake_transport("[]", "[]")
	local kit = daemon.new({ transport = transport })
	kit:monitors()

	transport.request = function()
		error("socket gone", 0)
	end

	local monitors, err = kit:monitors({ force = true })
	assert_equal(err, "socket gone", "error surfaced to caller")
	assert_equal(#monitors, 0, "stale cache is empty but present")
end)

it("normalizes client geometry and preserves matcher fields", function()
	local transport = fake_transport(
		"[]",
		'[{"address":"0x1","class":"nemo","initialClass":"nemo","at":[12.4,"30"],"size":["800","600"],"floating":true,"tags":["pip*"]}]'
	)
	local kit = daemon.new({ transport = transport })
	local clients = kit:clients()

	assert_equal(#clients, 1, "client count")
	assert_equal(clients[1].at[1], 12.4, "x coerced to number")
	assert_equal(clients[1].at[2], 30, "y coerced to number")
	assert_equal(clients[1].size[1], 800, "width coerced to number")
	assert_equal(clients[1].size[2], 600, "height coerced to number")
	assert_equal(clients[1].initialClass, "nemo", "matcher field preserved")
	assert_equal(clients[1].tags[1], "pip*", "tags preserved")
end)

it("surfaces client query failures instead of raising", function()
	local transport = fake_transport("[]", "[]")
	local kit = daemon.new({ transport = transport })

	transport.request = function(message)
		if message == "j/clients" then
			error("query socket down", 0)
		end
		return "[]"
	end

	local clients, err = kit:clients()
	assert_equal(err, "query socket down", "error surfaced to caller")
	assert_equal(#clients, 0, "empty client list on failure")
end)

it("derives instance paths through the transport", function()
	local transport = fake_transport("[]", "[]")
	local kit = daemon.new({ transport = transport })

	assert_equal(kit:instance_path("window-state.cache"), "/fake/window-state.cache", "instance path")
	assert_equal(kit:socket_path(".socket.sock"), "/fake/socket.sock", "socket path")
end)

it("owns the one-line control socket lifecycle", function()
	local calls = {}
	local control_message = "quit"
	local client = {
		settimeout = function(_, timeout)
			calls.client_timeout = timeout
		end,
		receive = function(_, mode)
			calls.receive_mode = mode
			return control_message
		end,
		send = function(_, response)
			calls.response = response
		end,
		close = function()
			calls.client_closed = true
		end,
	}
	local server = {
		bind = function(_, path)
			calls.bound_path = path
			return true
		end,
		listen = function()
			calls.listened = true
			return true
		end,
		settimeout = function(_, timeout)
			calls.server_timeout = timeout
		end,
		accept = function()
			return client
		end,
		close = function()
			calls.server_closed = true
		end,
	}
	local removed = 0
	local kit = daemon.new({
		transport = fake_transport("[]", "[]"),
		unix_server = function()
			return server
		end,
		remove = function(path)
			removed = removed + 1
			calls.removed_path = path
		end,
	})

	local control = kit:control_socket("control.sock")
	assert_equal(control:reader(), server, "selectable reader")
	assert_equal(calls.bound_path, "/fake/socket.sock", "instance-scoped bind path")
	assert_equal(calls.listened, true, "server listens")
	assert_equal(calls.server_timeout, 0, "server is nonblocking")

	local received
	assert_equal(
		control:handle_ready(function(message)
			received = message
			return true
		end),
		true,
		"quit result"
	)
	assert_equal(received, "quit", "one-line message")
	assert_equal(calls.receive_mode, "*l", "line read mode")
	assert_equal(calls.client_timeout, 0.05, "bounded client read")
	assert_equal(calls.response, "ok\n", "health acknowledgement")
	assert_equal(calls.client_closed, true, "client closes after acknowledgement")

	control:handle_ready(function()
		return false, "error"
	end)
	assert_equal(calls.response, "error\n", "feature-specific acknowledgement")

	control_message = "restart"
	local feature_handler_called = false
	assert_equal(
		control:handle_ready(function()
			feature_handler_called = true
			return false
		end),
		"restart",
		"restart result"
	)
	assert_equal(feature_handler_called, false, "restart bypasses feature handlers")

	control:close()
	control:close()
	assert_equal(calls.server_closed, true, "server closes")
	assert_equal(calls.removed_path, "/fake/socket.sock", "owned socket path removed")
	assert_equal(removed, 1, "owned socket removed once")
end)

it("round-trips files through the kit helpers", function()
	local transport = fake_transport("[]", "[]")
	local kit = daemon.new({ transport = transport })
	local directory = os.getenv("TMPDIR") or "/tmp"
	local path = directory .. "/daemon-kit-spec-" .. tostring(os.time()) .. ".txt"

	kit:write_file(path, "hello")
	assert_equal(kit:read_file(path), "hello", "read after write")

	kit:write_shared_file(path, "shared")
	assert_equal(kit:read_file(path), "shared", "atomic write replaces content")

	os.remove(path)
	assert_equal(kit:read_file(path), nil, "missing file reads as nil")
end)

it("query falls back to hyprctl when the transport yields nothing", function()
	local transport = fake_transport("", "")
	local spawned = {}
	local kit = daemon.new({
		transport = transport,
		spawn = function(command_line)
			spawned[#spawned + 1] = command_line
			return '[{"id":1,"name":"DP-2"}]'
		end,
	})

	assert_equal(kit:query("j/monitors"), '[{"id":1,"name":"DP-2"}]', "fallback response")
	assert_equal(#spawned, 1, "one spawn")
	assert_equal(spawned[1], "hyprctl monitors -j 2>/dev/null", "fallback command")

	assert_equal(kit:query("j/layers"), "", "unknown message skips fallback")
	assert_equal(#spawned, 1, "no extra spawn for unknown message")
end)

it("query prefers the transport when it responds", function()
	local transport = fake_transport("[]", "[]")
	local spawned = {}
	local kit = daemon.new({
		transport = transport,
		spawn = function()
			spawned[#spawned + 1] = true
			return ""
		end,
	})

	assert_equal(kit:query("j/clients"), "[]", "transport response used")
	assert_equal(#spawned, 0, "no spawn when transport responds")
end)

it("clients with fallback normalizes the spawned response", function()
	local transport = fake_transport("", "")
	local kit = daemon.new({
		transport = transport,
		spawn = function()
			return '[{"address":"0x2","at":["5","6"],"size":[10,20]}]'
		end,
	})

	local clients = kit:clients({ fallback = true })
	assert_equal(#clients, 1, "client count")
	assert_equal(clients[1].at[1], 5, "x coerced after fallback")
end)
