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
}

local function waybar_layers(alpha)
	return {
		["DP-1"] = {
			levels = {
				top = {
					{ namespace = "waybar", alpha = alpha },
				},
			},
		},
	}
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

local function command_index(values, pattern)
	for index, value in ipairs(values) do
		if value:match(pattern) then
			return index
		end
	end
	return math.huge
end

local function run_scenario(options)
	local scenario = {
		now = options.now or 0,
		layers = options.layers or {},
		pending_state = options.pending_state,
		visibility_state = options.visibility_state,
		process_running = options.process_running == true,
		process_starts = options.process_starts == true,
		launch_ok = options.launch_ok ~= false,
		signal_show_ok = options.signal_show_ok ~= false,
		signal_hide_ok = options.signal_hide_ok ~= false,
		fail_write = options.fail_write == true,
		commands = {},
		responses = {},
		steps = options.steps,
		step_index = 0,
		reader = {},
	}

	local control = {}
	function control:reader()
		return scenario.reader
	end
	function control:handle_ready(handler)
		local step = assert(scenario.current_step)
		local result, response = handler(assert(step.message))
		scenario.responses[#scenario.responses + 1] = response
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
		if path == "/fixture/waybar-launch.pending" then
			return scenario.pending_state
		end
		assert(path == "/fixture/waybar-visibility.state")
		return scenario.visibility_state
	end
	function kit:write_shared_file(path, content)
		if scenario.fail_write then
			error("simulated publication failure")
		end
		if path == "/fixture/waybar-launch.pending" then
			scenario.pending_state = content
			return
		end
		assert(path == "/fixture/waybar-visibility.state")
		scenario.visibility_state = content
	end
	function kit:remove_file(path)
		if path == "/fixture/waybar-launch.pending" then
			scenario.pending_state = nil
		else
			assert(path == "/fixture/waybar-visibility.state")
			scenario.visibility_state = nil
		end
		return true
	end

	local fake_socket = {
		gettime = function()
			return scenario.now / 1000
		end,
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
			if command_line:match("uwsm%-app %-s s") then
				if scenario.process_starts then
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
			return true
		end,
		output = function()
			return ""
		end,
	}

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
			return ""
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

	dofile(monitor)
	return scenario
end

local cold = run_scenario({
	steps = {
		{ message = "show" },
		{ message = "show" },
		{
			message = "layer-opened",
			before = function(scenario)
				scenario.layers = waybar_layers(0)
			end,
		},
		{
			message = "layer-opened",
			before = function(scenario)
				scenario.layers = waybar_layers(1)
			end,
		},
		{ message = "quit" },
	},
})
assert(count_matching(cold.commands, "uwsm%-app %-s s") == 1)
assert(count_matching(cold.commands, "waybar%-process%.sh signal USR1") == 1)
assert(command_index(cold.commands, "waybar%-show") < command_index(cold.commands, "uwsm%-app"))
assert(cold.pending_state == nil)
assert(
	cold.responses[1] == "ok"
		and cold.responses[2] == "ok"
		and cold.responses[3] == "ok"
		and cold.responses[4] == "ok"
		and cold.responses[5] == "ok"
)

local warm = run_scenario({
	layers = waybar_layers(0),
	steps = {
		{ message = "show" },
		{ message = "quit" },
	},
})
assert(count_matching(warm.commands, "uwsm%-app %-s s") == 0)
assert(count_matching(warm.commands, "waybar%-process%.sh signal USR1") == 1)

local withdrawn = run_scenario({
	steps = {
		{ message = "show" },
		{ message = "hide" },
		{
			message = "layer-opened",
			before = function(scenario)
				scenario.layers = waybar_layers(1)
			end,
		},
		{ message = "quit" },
	},
})
assert(count_matching(withdrawn.commands, "uwsm%-app %-s s") == 1)
assert(count_matching(withdrawn.commands, "waybar%-process%.sh signal USR1") == 0)
assert(count_matching(withdrawn.commands, "waybar%-process%.sh signal USR2") == 1)
assert(withdrawn.pending_state == nil)

local delayed_hide = run_scenario({
	signal_hide_ok = false,
	steps = {
		{ message = "show" },
		{ message = "hide" },
		{
			message = "layer-opened",
			before = function(scenario)
				scenario.layers = waybar_layers(1)
			end,
		},
		{
			message = "layer-opened",
			before = function(scenario)
				scenario.signal_hide_ok = true
			end,
		},
		{ message = "quit" },
	},
})
assert(delayed_hide.responses[3] == "error: signal-failed")
assert(count_matching(delayed_hide.commands, "waybar%-process%.sh signal USR2") == 2)
assert(delayed_hide.pending_state == nil)
assert(delayed_hide.visibility_state == "hidden\n")

local replacement = run_scenario({
	now = 1000,
	layers = waybar_layers(1),
	pending_state = "1000\thide\n",
	steps = {
		{ message = "quit" },
	},
})
assert(count_matching(replacement.commands, "waybar%-process%.sh signal USR2") == 1)
assert(replacement.pending_state == nil)

local hidden_restart = run_scenario({
	layers = waybar_layers(1),
	visibility_state = "hidden\n",
	steps = {
		{ message = "quit" },
	},
})
assert(count_matching(hidden_restart.commands, "waybar%-process%.sh signal USR2") == 1)
assert(count_matching(hidden_restart.commands, "waybar%-process%.sh signal USR1") == 0)
assert(hidden_restart.visibility_state == "hidden\n")

local failed_publication = run_scenario({
	fail_write = true,
	steps = {
		{ message = "show" },
		{ message = "quit" },
	},
})
assert(count_matching(failed_publication.commands, "uwsm%-app %-s s") == 0)
assert(failed_publication.responses[1] == "error: launch-failed")

local timed_out = run_scenario({
	steps = {
		{ message = "show" },
		{ advance = 11000 },
		{ message = "quit" },
	},
})
assert(count_matching(timed_out.commands, "uwsm%-app %-s s") == 1)
assert(count_matching(timed_out.commands, "waybar%-process%.sh running") == 2)
assert(timed_out.pending_state == nil)
assert(count_matching(timed_out.commands, "waybar%-hide") == 2)

local slow_process = run_scenario({
	process_starts = true,
	steps = {
		{ message = "show" },
		{ advance = 11000 },
		{ advance = 11000 },
		{ message = "show" },
		{ message = "quit" },
	},
})
assert(count_matching(slow_process.commands, "uwsm%-app %-s s") == 1)
assert(count_matching(slow_process.commands, "waybar%-process%.sh running") == 3)
assert(slow_process.pending_state ~= nil)

local recovered_process = run_scenario({
	process_starts = true,
	steps = {
		{ message = "show" },
		{ advance = 11000 },
		{
			message = "show",
			before = function(scenario)
				scenario.process_running = false
			end,
		},
		{ message = "quit" },
	},
})
assert(count_matching(recovered_process.commands, "uwsm%-app %-s s") == 2)
assert(count_matching(recovered_process.commands, "%-u app%-Hyprland%-waybar%-demand%-") == 2)

local reordered_events = run_scenario({
	steps = {
		{ message = "show" },
		{ message = "layer-closed" },
		{ message = "layer-opened" },
		{ advance = 11000 },
		{ message = "quit" },
	},
})
assert(count_matching(reordered_events.commands, "uwsm%-app %-s s") == 1)
assert(reordered_events.pending_state == nil)
assert(reordered_events.visibility_state == nil)

local exited = run_scenario({
	layers = waybar_layers(1),
	steps = {
		{
			message = "layer-closed",
			before = function(scenario)
				scenario.layers = {}
			end,
		},
		{ message = "quit" },
	},
})
assert(command_index(exited.commands, "waybar%-hide") < math.huge)

local invalid = run_scenario({
	steps = {
		{ message = "invalid" },
		{ message = "quit" },
	},
})
assert(invalid.responses[1] == "error: invalid-command")

print("PASS waybar monitor owns one demand-driven launch and reconciles lifecycle events")
