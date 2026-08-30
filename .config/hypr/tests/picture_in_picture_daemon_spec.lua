local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/picture_in_picture_daemon_spec%.lua$") or ".config/hypr"
local daemon_path = config_dir .. "/runtime/windows/daemons/picture-in-picture.lua"

local module_names = {
	"socket",
	"runtime.lib.ags-ipc",
	"lib.json",
	"runtime.lib.daemon",
	"lib.pip_placement",
	"lib.picture_in_picture",
	"lib.rate_limit",
}

local function run_daemon(options)
	local saved_modules = {}
	for _, name in ipairs(module_names) do
		saved_modules[name] = package.loaded[name]
	end

	local events = {}
	local requests = {}
	local ags_requests = {}
	local reducer_inputs = {}
	local rate_limit_calls = {}
	local reset_calls = {}
	local control_messages = {}
	local monitor_queries = 0
	local client_queries = 0
	local active_queries = 0
	local event_connects = 0
	local event_closed = 0
	local control_closed = 0
	local select_timeouts = {}
	local control_reader = {}
	local selected_roles = options.selected or {}
	local control_messages_to_read = options.control_messages or { "quit" }
	local event_lines = options.event_lines or {}
	local now = options.now or 10

	package.loaded.socket = {
		gettime = function()
			return now
		end,
		select = function(readers, _, timeout)
			select_timeouts[#select_timeouts + 1] = timeout
			local role = table.remove(selected_roles, 1)
			if role == "control" then
				return { readers[1] }
			end
			if role == "event" then
				return { readers[2] }
			end
			if role == "timeout" then
				now = now + timeout
			end
			return {}
		end,
	}
	package.loaded["runtime.lib.ags-ipc"] = {
		request = function(name, payload)
			ags_requests[#ags_requests + 1] = { name = name, payload = payload }
		end,
	}
	package.loaded["lib.json"] = {
		encode = function(value)
			if type(value) == "table" then
				return string.format('{"x":%d,"y":%d,"action":%q}', value.x, value.y, value.action)
			end
			return string.format("%q", value)
		end,
		object = function(value)
			if value == "waybar-config" then
				return { position = "bottom", height = 30 }
			end
			if value == "layers" then
				return options.waybar_layers or {}
			end
			return {}
		end,
	}

	local state = {
		waybar_visible = false,
		dragging = options.dragging == true,
		dragging_address = options.dragging_address,
		next_observation_at = options.next_observation_at or math.huge,
		reconcile_at = options.reconcile_at,
	}
	package.loaded["lib.pip_placement"] = {
		new = function()
			return state
		end,
		rectangle = function(x, y, width, height)
			return { x = x, y = y, width = width, height = height }
		end,
		overlaps = function()
			return options.waybar_layers_overlap == true
		end,
		drag_interval_s = 0.1,
		tick_due = function(_, current)
			return current >= state.next_observation_at or (state.reconcile_at ~= nil and current >= state.reconcile_at)
		end,
		place = function(_, input)
			local captured = {
				event = input.event,
				monitors = input.monitors,
				bars = input.bars,
			}
			if input.event.type == "startup" or input.event.native_interaction then
				captured.clients = input.clients
			end
			if input.event.native_interaction then
				captured.active = input.active
			end
			reducer_inputs[#reducer_inputs + 1] = captured
			if input.event.type == "tick" then
				state.next_observation_at = math.huge
				state.reconcile_at = nil
			end
			if input.event.type ~= "startup" then
				return state, {}
			end
			return state,
				{
					{ kind = "move", address = "0x1", x = 12, y = 34 },
					{ kind = "tag", address = "0x1", tag = "pip-bottom-right", add = true },
					{ kind = "preview", target = { x = 12, y = 34 } },
					{ kind = "cursor-outline", enabled = true },
					{ kind = "accept-placement", placement = { kind = "corner" } },
					{ kind = "acceptance-timeout" },
				}
		end,
	}
	package.loaded["lib.picture_in_picture"] = {
		class = "app.zen_browser.zen",
		title = "Picture-in-Picture",
		control = {
			decode = function(message)
				control_messages[#control_messages + 1] = message
				if message == "move left 0xbeef" then
					return "move", "0xbeef", "left"
				end
				return message
			end,
		},
		acceptance = {
			encode = function(value)
				return "accept " .. value.kind
			end,
		},
	}
	package.loaded["lib.rate_limit"] = {
		new = function()
			return function(key, message)
				rate_limit_calls[#rate_limit_calls + 1] = { key = key, message = message }
			end, function(key)
				reset_calls[#reset_calls + 1] = key
			end
		end,
	}

	local function event_socket()
		return {
			receive = function()
				local line = table.remove(event_lines, 1)
				if line == "closed" then
					return nil, "closed"
				end
				return line
			end,
			close = function()
				event_closed = event_closed + 1
			end,
		}
	end

	package.loaded["runtime.lib.daemon"] = {
		restart_exit_status = 75,
		new = function()
			return {
				socket_path = function()
					return "/tmp/window-state.sock"
				end,
				monitors = function(_, query_opts)
					monitor_queries = monitor_queries + 1
					if query_opts then
						return { { name = "DP-1", id = "1", x = 0, y = 0, width = 200, height = 100 } }
					end
					return { { name = "DP-1", id = "1", x = 0, y = 0, width = 100, height = 100 } }
				end,
				clients = function()
					client_queries = client_queries + 1
					return { { address = "0x1" } }
				end,
				request = function(_, message, request_options)
					requests[#requests + 1] = { message = message, options = request_options }
					if message:match("^accept ") then
						return options.acceptance_response or "ok\n"
					end
					if message == "j/activewindow" then
						active_queries = active_queries + 1
						return "active"
					end
					return "layers"
				end,
				read_file = function()
					return "waybar-config"
				end,
				connect_events = function()
					event_connects = event_connects + 1
					return event_socket()
				end,
				control_socket = function()
					return {
						reader = function()
							return control_reader
						end,
						handle_ready = function(_, handler)
							return handler(table.remove(control_messages_to_read, 1))
						end,
						close = function()
							control_closed = control_closed + 1
						end,
					}
				end,
			}
		end,
	}

	local ok, err = pcall(assert(loadfile(daemon_path)))
	for _, name in ipairs(module_names) do
		package.loaded[name] = saved_modules[name]
	end
	assert.is_true(ok, err)
	return {
		active_queries = active_queries,
		ags_requests = ags_requests,
		client_queries = client_queries,
		control_closed = control_closed,
		control_messages = control_messages,
		event_closed = event_closed,
		event_connects = event_connects,
		monitor_queries = monitor_queries,
		rate_limit_calls = rate_limit_calls,
		requests = requests,
		reducer_inputs = reducer_inputs,
		reset_calls = reset_calls,
		select_timeouts = select_timeouts,
	}
end

describe("picture-in-picture daemon adapter", function()
	it("adapts startup, controls, monitor reloads, and reducer commands at runtime boundaries", function()
		local result = run_daemon({
			selected = { "event", "event", "control", "control" },
			event_lines = { "openwindow>>beef,ignored", "configreloaded>>" },
			control_messages = { "move left 0xbeef", "quit" },
		})

		assert.equal(2, result.monitor_queries)
		assert.equal("startup", result.reducer_inputs[1].event.type)
		assert.same({ address = "0x1" }, result.reducer_inputs[1].clients[1])
		assert.equal(1, result.client_queries)
		assert.equal(0, result.active_queries)
		assert.equal("compositor", result.reducer_inputs[2].event.type)
		assert.equal("openwindow", result.reducer_inputs[2].event.name)
		assert.equal("0xbeef", result.reducer_inputs[2].event.address)
		assert.equal("monitorchange", result.reducer_inputs[3].event.type)
		assert.equal("move", result.reducer_inputs[4].event.action)
		assert.equal("left", result.reducer_inputs[4].event.direction)
		assert.equal("quit", result.reducer_inputs[5].event.action)
		assert.same({ "move left 0xbeef", "quit" }, result.control_messages)

		local requests_by_message = {}
		for _, request in ipairs(result.requests) do
			requests_by_message[request.message] = request
		end
		assert.is_not_nil(
			requests_by_message['dispatch hl.dsp.window.move({ x = 12, y = 34, window = "address:0x1" })']
		)
		assert.is_not_nil(
			requests_by_message['dispatch hl.dsp.window.tag({ tag = "+pip-bottom-right", window = "address:0x1" })']
		)
		assert.is_not_nil(requests_by_message["eval hl.plugin.cursor_outline.on()"])
		assert.same({ path = "/tmp/window-state.sock", timeout = 1 }, requests_by_message["accept corner\n"].options)
		assert.same({
			{ name = "pip-snap-preview", payload = '{"x":12,"y":34,"action":"show"}' },
			{ name = "pip-snap-preview", payload = '{"action":"hide"}' },
		}, result.ags_requests)
		assert.same({ "placement-acceptance" }, result.reset_calls)
		assert.same(
			{ { key = "placement-observation", message = "final placement was not observed" } },
			result.rate_limit_calls
		)
		assert.equal(1, result.event_closed)
		assert.equal(1, result.control_closed)
	end)

	it("uses native geometry updates for drag previews without querying clients", function()
		local result = run_daemon({
			selected = { "control", "event", "control" },
			control_messages = { "interaction-updates-ready", "quit" },
			event_lines = { "windowinteractionupdated>>0x1,move,1,2960,1150,400,225" },
			dragging = true,
			dragging_address = "0x1",
		})

		assert.equal("startup", result.reducer_inputs[1].event.type)
		assert.equal("tick", result.reducer_inputs[2].event.type)
		assert.same({ 2960, 1150 }, result.reducer_inputs[2].active.at)
		assert.same({ 400, 225 }, result.reducer_inputs[2].active.size)
		assert.equal("1", result.reducer_inputs[2].active.monitor)
		assert.equal("0x1", result.reducer_inputs[2].active.address)
		assert.equal("quit", result.reducer_inputs[3].event.action)
		assert.equal(1, result.client_queries)
		assert.equal(0, result.active_queries)
		assert.equal(0.1, result.select_timeouts[1])
		assert.same({ "quit" }, result.control_messages)
	end)

	it("uses visible bar geometry for hide policy, then clears it for native updates", function()
		local result = run_daemon({
			selected = { "control", "event", "control" },
			control_messages = { "waybar-hide", "quit" },
			event_lines = { "windowinteractionupdated>>0x1,move,1,2960,1150,400,225" },
			dragging = true,
			dragging_address = "0x1",
			waybar_layers_overlap = true,
			waybar_layers = {
				["DP-1"] = {
					levels = {
						top = {
							{ namespace = "waybar", alpha = 1, x = 0, y = 70, w = 100, h = 30 },
						},
					},
				},
			},
		})

		assert.equal("waybar-hide", result.reducer_inputs[2].event.action)
		assert.equal(1, #result.reducer_inputs[2].bars["DP-1"])
		assert.equal("tick", result.reducer_inputs[3].event.type)
		assert.same({}, result.reducer_inputs[3].bars)
	end)

	it("reconnects after an event socket closes and rate-limits a rejected placement acceptance", function()
		local result = run_daemon({
			selected = { "event", "control" },
			event_lines = { "closed" },
			acceptance_response = "rejected\n",
		})

		assert.equal(2, result.event_connects)
		assert.equal(2, result.event_closed)
		assert.same({
			{ key = "placement-acceptance", message = "accepted placement was not persisted" },
			{ key = "placement-observation", message = "final placement was not observed" },
		}, result.rate_limit_calls)
		assert.same({}, result.reset_calls)
	end)

	it("delivers reducer ticks when the next state-machine deadline becomes due", function()
		local result = run_daemon({
			selected = { "timeout", "control" },
			control_messages = { "quit" },
			now = 10,
			next_observation_at = 10.25,
		})

		assert.equal(0.25, result.select_timeouts[1])
		assert.equal("startup", result.reducer_inputs[1].event.type)
		assert.equal("tick", result.reducer_inputs[2].event.type)
		assert.equal("quit", result.reducer_inputs[3].event.action)
		assert.equal(1, result.client_queries)
		assert.equal(0, result.active_queries)
	end)
end)
