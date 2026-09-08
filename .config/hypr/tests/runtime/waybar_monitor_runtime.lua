#!/usr/bin/env luajit

local repo_root = os.getenv("REPO_ROOT") or "."
local monitor = repo_root .. "/.config/hypr/runtime/desktop/waybar-monitor.lua"
local module_names = {
	"socket",
	"runtime.lib.ags-ipc",
	"lib.command",
	"runtime.lib.daemon",
	"gaming.policies",
	"runtime.lib.hypr-ipc",
	"lib.json",
	"lib.picture_in_picture",
	"runtime.desktop.waybar-workers",
}

local function waybar_layers_on_outputs(outputs)
	local layers = {}
	for _, name in ipairs(outputs) do
		layers[name] = { levels = { top = { { namespace = "waybar", alpha = 1 } } } }
	end
	return layers
end

local function count_matching(values, pattern)
	local count = 0
	for _, value in ipairs(values) do
		if value:match(pattern) then
			count = count + 1
		end
	end
	return count
end

local function contains(values, pattern)
	return count_matching(values, pattern) > 0
end

local function run_scenario(options)
	local scenario = {
		now = options.now or 0,
		layers = options.layers or {},
		visibility_state = options.visibility_state,
		process_running = options.process_running == true,
		launch_ok = options.launch_ok ~= false,
		signal_show_ok = options.signal_show_ok ~= false,
		signal_hide_ok = options.signal_hide_ok ~= false,
		pip_ok = options.pip_ok ~= false,
		fail_write = options.fail_write == true,
		commands = {},
		responses = {},
		trace = {},
		workers = {},
		cancellations = {},
		steps = options.steps,
		step_index = 0,
		reader = {},
	}

	function scenario:complete_worker(label)
		for _, worker in ipairs(self.workers) do
			if worker.label == label and not worker.finished and not worker.cancelled then
				worker.complete = true
				return worker
			end
		end
		error("no active " .. label .. " worker")
	end

	local control = {}
	function control:reader()
		return scenario.reader
	end
	function control:handle_ready(handler)
		local step = assert(scenario.current_step)
		if step.message == "restart" then
			scenario.responses[#scenario.responses + 1] = "ok"
			scenario.trace[#scenario.trace + 1] = "response:restart"
			return "restart"
		end
		local result, response = handler(assert(step.message))
		scenario.responses[#scenario.responses + 1] = response
		scenario.trace[#scenario.trace + 1] = "response:" .. step.message
		return result
	end
	function control:close() end

	local kit = {}
	function kit:instance_path(name)
		return "/fixture/" .. name
	end
	function kit:control_socket(name)
		assert(name == "waybar-monitor.sock")
		return control
	end
	function kit:read_file(path)
		assert(path == "/fixture/waybar-visibility.state")
		return scenario.visibility_state
	end
	function kit:write_shared_file(path, content)
		assert(path == "/fixture/waybar-visibility.state")
		if scenario.fail_write then
			error("simulated publication failure")
		end
		scenario.visibility_state = content
	end
	function kit:remove_file(path)
		assert(path == "/fixture/waybar-visibility.state")
		scenario.visibility_state = nil
		return true
	end

	local fake_socket = {
		gettime = function()
			return scenario.now / 1000
		end,
		sleep = function() end,
		select = function()
			scenario.step_index = scenario.step_index + 1
			local step = assert(scenario.steps[scenario.step_index], "monitor did not terminate")
			if step.advance then
				scenario.now = scenario.now + step.advance
			end
			if step.before then
				step.before(scenario)
			end
			scenario.current_step = step
			if step.message then
				return { scenario.reader }
			end
			return {}
		end,
	}

	local fake_command = {
		arg = function(value)
			return tostring(value)
		end,
		line = function(...)
			local values = { ... }
			for index, value in ipairs(values) do
				values[index] = tostring(value)
			end
			return table.concat(values, " ")
		end,
		ok = function(command_line)
			scenario.commands[#scenario.commands + 1] = command_line
			if command_line:match("waybar%-process%.sh replace%-unit") then
				if scenario.launch_ok then
					scenario.process_running = true
				end
				return scenario.launch_ok
			end
			if command_line:match("waybar%-process%.sh signal USR1") then
				return scenario.signal_show_ok
			end
			if command_line:match("waybar%-process%.sh signal USR2") then
				return scenario.signal_hide_ok
			end
			if command_line:match("waybar%-process%.sh running") then
				return scenario.process_running
			end
			if command_line:match("waybar%-show") or command_line:match("waybar%-hide") then
				return scenario.pip_ok
			end
			return true
		end,
		output = function()
			return ""
		end,
	}

	local fake_workers = {}
	function fake_workers.start(label, run, metadata)
		local worker = {
			label = label,
			run = run,
			metadata = metadata,
		}
		scenario.workers[#scenario.workers + 1] = worker
		scenario.trace[#scenario.trace + 1] = "worker:" .. label
		return worker
	end
	function fake_workers.reap(worker)
		if worker.cancelled then
			worker.finished = true
			return true, false
		end
		if not worker.complete then
			return nil
		end
		worker.finished = true
		local ok, succeeded = pcall(worker.run)
		return true, ok and succeeded
	end
	function fake_workers.terminate(worker)
		worker.cancelled = true
		scenario.cancellations[#scenario.cancellations + 1] = "term:" .. worker.label
		return true
	end
	function fake_workers.kill(worker)
		worker.cancelled = true
		scenario.cancellations[#scenario.cancellations + 1] = "kill:" .. worker.label
		return true
	end
	function fake_workers.wait(worker)
		worker.finished = true
		scenario.cancellations[#scenario.cancellations + 1] = "wait:" .. worker.label
		return false
	end

	local fake_json = {
		object = function(value)
			if value == "layers" then
				return scenario.layers
			end
			if value == "workspace" then
				return { name = "1" }
			end
			return {}
		end,
	}

	for _, name in ipairs(module_names) do
		package.loaded[name] = nil
		package.preload[name] = nil
	end
	package.loaded.socket = fake_socket
	package.loaded["runtime.lib.ags-ipc"] = {
		request = function()
			return "none"
		end,
	}
	package.loaded["lib.command"] = fake_command
	package.loaded["runtime.lib.daemon"] = {
		restart_exit_status = 75,
		new = function()
			return kit
		end,
	}
	package.loaded["gaming.policies"] = { workspace = "10" }
	package.loaded["runtime.lib.hypr-ipc"] = {
		instance_socket_path = function(name)
			return "/fixture/" .. name
		end,
		request = function(message)
			if message == "j/layers" then
				return "layers"
			end
			if message == "j/activeworkspace" then
				return "workspace"
			end
			return ""
		end,
	}
	package.loaded["lib.json"] = fake_json
	package.loaded["lib.picture_in_picture"] = {
		control = {
			encode = function(action)
				return action
			end,
		},
	}
	package.loaded["runtime.desktop.waybar-workers"] = fake_workers

	local original_exit = os.exit
	os.exit = function(status)
		error({ exit_status = status })
	end
	local ok, result = pcall(dofile, monitor)
	os.exit = original_exit
	if not ok then
		if type(result) ~= "table" or result.exit_status ~= 75 then
			error(result, 0)
		end
	end
	return scenario
end

local acknowledged_before_effects = run_scenario({
	steps = {
		{ message = "show" },
		{ message = "hide" },
		{ message = "release" },
		{ message = "quit" },
	},
})
assert(acknowledged_before_effects.responses[1] == "ok")
assert(acknowledged_before_effects.responses[2] == "ok")
assert(acknowledged_before_effects.responses[3] == "ok")
assert(acknowledged_before_effects.trace[1] == "response:show")
assert(acknowledged_before_effects.trace[2] == "worker:launch")
assert(not contains(acknowledged_before_effects.commands, "replace%-unit"))
assert(acknowledged_before_effects.visibility_state == "hidden\n")
assert(contains(acknowledged_before_effects.cancellations, "term:launch"))

local cancelled_on_quit = run_scenario({
	steps = {
		{ message = "show" },
		{ message = "quit" },
	},
})
assert(contains(cancelled_on_quit.cancellations, "term:launch"))
assert(not contains(cancelled_on_quit.commands, "replace%-unit"))

local cancelled_on_restart = run_scenario({
	steps = {
		{ message = "show" },
		{ message = "restart" },
	},
})
assert(contains(cancelled_on_restart.cancellations, "term:launch"))
assert(not contains(cancelled_on_restart.commands, "replace%-unit"))

local all_public_intents = run_scenario({
	steps = {
		{ message = "show" },
		{ message = "hide" },
		{ message = "prewarm" },
		{ message = "hold" },
		{ message = "release" },
		{ message = "quit" },
	},
})
assert(#all_public_intents.responses == 6)
for index = 1, 5 do
	assert(all_public_intents.responses[index] == "ok")
end
assert(all_public_intents.visibility_state == "shown\n")
assert(count_matching(all_public_intents.trace, "worker:launch") == 1)

local hide_wins_before_mapping = run_scenario({
	steps = {
		{ message = "show" },
		{ message = "hide" },
		{
			message = "layer-opened",
			before = function(scenario)
				scenario.layers = waybar_layers_on_outputs({ "DP-1" })
			end,
		},
		{ message = "quit" },
	},
})
assert(count_matching(hide_wins_before_mapping.trace, "worker:launch") == 1)
assert(count_matching(hide_wins_before_mapping.trace, "worker:visibility") == 1)
local hide_worker = hide_wins_before_mapping.workers[2]
assert(hide_worker.metadata.visible == false)
assert(type(hide_worker.metadata.layer_count) == "number")

local signal_retries = run_scenario({
	layers = waybar_layers_on_outputs({ "DP-1" }),
	visibility_state = "shown\n",
	signal_show_ok = false,
	steps = {
		{
			before = function(scenario)
				scenario:complete_worker("visibility")
			end,
		},
		{
			before = function(scenario)
				scenario.signal_show_ok = true
				scenario:complete_worker("visibility")
			end,
		},
		{ message = "quit" },
	},
})
assert(count_matching(signal_retries.commands, "waybar%-process%.sh signal USR1") == 2)
assert(count_matching(signal_retries.trace, "worker:visibility") == 2)

local duplicate_mapping = run_scenario({
	layers = waybar_layers_on_outputs({ "DP-1" }),
	visibility_state = "shown\n",
	steps = {
		{ message = "layer-opened" },
		{
			before = function(scenario)
				scenario:complete_worker("visibility")
			end,
		},
		{ message = "layer-opened" },
		{ message = "quit" },
	},
})
assert(count_matching(duplicate_mapping.trace, "worker:visibility") == 1)

local output_readded = run_scenario({
	layers = waybar_layers_on_outputs({ "DP-1" }),
	visibility_state = "shown\n",
	steps = {
		{
			before = function(scenario)
				scenario:complete_worker("visibility")
			end,
		},
		{
			message = "layer-opened",
			before = function(scenario)
				scenario.layers = waybar_layers_on_outputs({ "DP-1", "DP-2" })
			end,
		},
		{
			before = function(scenario)
				scenario:complete_worker("visibility")
			end,
		},
		{
			message = "layer-closed",
			before = function(scenario)
				scenario.layers = waybar_layers_on_outputs({ "DP-1" })
			end,
		},
		{
			message = "layer-opened",
			before = function(scenario)
				scenario.layers = waybar_layers_on_outputs({ "DP-1", "DP-2" })
			end,
		},
		{
			before = function(scenario)
				scenario:complete_worker("visibility")
			end,
		},
		{ message = "quit" },
	},
})
assert(count_matching(output_readded.trace, "worker:visibility") == 3)
assert(count_matching(output_readded.commands, "waybar%-process%.sh signal USR1") == 3)

local remapped_after_zero = run_scenario({
	layers = waybar_layers_on_outputs({ "DP-1" }),
	visibility_state = "shown\n",
	steps = {
		{
			before = function(scenario)
				scenario:complete_worker("visibility")
			end,
		},
		{
			message = "layer-closed",
			before = function(scenario)
				scenario.layers = {}
			end,
		},
		{
			message = "layer-opened",
			before = function(scenario)
				scenario.layers = waybar_layers_on_outputs({ "DP-1" })
			end,
		},
		{
			before = function(scenario)
				scenario:complete_worker("visibility")
			end,
		},
		{ message = "quit" },
	},
})
assert(count_matching(remapped_after_zero.trace, "worker:visibility") == 2)
assert(count_matching(remapped_after_zero.commands, "waybar%-process%.sh signal USR1") == 2)

local delayed_pip = run_scenario({
	layers = waybar_layers_on_outputs({ "DP-1" }),
	visibility_state = "shown\n",
	steps = {
		{
			before = function(scenario)
				scenario:complete_worker("visibility")
			end,
		},
		{ message = "hide" },
		{ message = "release" },
		{ message = "quit" },
	},
})
assert(delayed_pip.responses[1] == "ok" and delayed_pip.responses[2] == "ok")
assert(contains(delayed_pip.trace, "worker:pip"))
assert(not contains(delayed_pip.commands, "waybar%-show"))

local visibility_cancelled_on_quit = run_scenario({
	layers = waybar_layers_on_outputs({ "DP-1" }),
	visibility_state = "shown\n",
	steps = {
		{ message = "quit" },
	},
})
assert(contains(visibility_cancelled_on_quit.cancellations, "term:visibility"))

local invalid = run_scenario({
	steps = {
		{ message = "invalid" },
		{ message = "quit" },
	},
})
assert(invalid.responses[1] == "error: invalid-command")

print("PASS Waybar monitor acknowledges durable intents before tracked workers converge latest state")
