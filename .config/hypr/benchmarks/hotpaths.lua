local script_path = arg[0] or ""
local config_dir = script_path:match("^(.*)/benchmarks/hotpaths%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local default_iterations = tonumber(os.getenv("HYPR_BENCH_ITERATIONS") or "10000") or 10000
local ffi = require("ffi")

ffi.cdef([[
	typedef long time_t;
	typedef struct { time_t tv_sec; long tv_nsec; } timespec;
	int clock_gettime(int clock_id, timespec *tp);
]])

local CLOCK_MONOTONIC = 1
local CLOCK_PROCESS_CPUTIME_ID = 2

local function clock_time(clock_id)
	local time = ffi.new("timespec[1]")
	assert(ffi.C.clock_gettime(clock_id, time) == 0, "clock_gettime failed")
	return tonumber(time[0].tv_sec) + tonumber(time[0].tv_nsec) / 1000000000
end
local dispatches = 0
local execs = 0
local current_windows = {}
local current_workspace = nil
local active_window = nil
local active_monitor = { name = "DP-2" }
local events = {}
local layout_providers = {}

local function clear_modules()
	for name in pairs(package.loaded) do
		if name:match("^actions%.") or name:match("^layouts%.") or name:match("^profiles") or name == "rule-loader" then
			package.loaded[name] = nil
		end
	end
end

local function reset_counters()
	dispatches = 0
	execs = 0
end

local function reset_events()
	events = {}
	layout_providers = {}
end

local function make_window(index, opts)
	opts = opts or {}
	return {
		address = "0x" .. tostring(index),
		active = opts.active or false,
		class = opts.class or "kitty",
		initial_class = opts.initial_class or opts.class or "kitty",
		floating = opts.floating or false,
		monitor = opts.monitor,
		stable_id = opts.stable_id or index,
		at = opts.at,
		size = opts.size,
		visible = opts.visible ~= false,
		workspace = opts.workspace,
	}
end

local function make_workspace(count, opts)
	opts = opts or {}
	local workspace = {
		name = opts.name or "1",
		id = opts.id or 1,
		active = opts.active ~= false,
		monitor = { name = opts.monitor or "DP-2" },
		tiled_layout = opts.layout or "master",
	}

	local windows = {}
	for index = 1, count do
		windows[index] = make_window(index, {
			workspace = workspace,
			floating = opts.floating or false,
			monitor = workspace.monitor,
		})
	end

	function workspace:get_windows()
		return windows
	end

	workspace.windows = windows
	return workspace
end

hl = {
	dsp = {
		exec_cmd = function(command)
			return { op = "exec_cmd", command = command }
		end,
		cursor = {
			move = function(args)
				return { op = "cursor.move", args = args }
			end,
		},
		focus = function(args)
			return { op = "focus", args = args }
		end,
		layout = function(value)
			return { op = "layout", value = value }
		end,
		window = {
			move = function(args)
				return { op = "window.move", args = args }
			end,
			swap = function(args)
				return { op = "window.swap", args = args }
			end,
			resize = function(args)
				return { op = "window.resize", args = args }
			end,
			close = function()
				return { op = "window.close" }
			end,
		},
	},
	dispatch = function()
		dispatches = dispatches + 1
	end,
	exec_cmd = function()
		execs = execs + 1
	end,
	get_windows = function()
		return current_windows
	end,
	get_active_window = function()
		return active_window
	end,
	get_active_monitor = function()
		return active_monitor
	end,
	on = function(name, callback)
		events[name] = events[name] or {}
		table.insert(events[name], callback)
	end,
	layout = {
		register = function(name, layout)
			layout_providers[name] = layout
		end,
	},
	window_rule = function()
		dispatches = dispatches + 1
	end,
	config = function()
		dispatches = dispatches + 1
	end,
}

local function run_case(name, iterations, fn, warmup_iterations)
	for _ = 1, warmup_iterations or 0 do
		fn()
	end

	collectgarbage("collect")
	reset_counters()
	local before_memory = collectgarbage("count")
	local wall_start = clock_time(CLOCK_MONOTONIC)
	local cpu_start = clock_time(CLOCK_PROCESS_CPUTIME_ID)
	for _ = 1, iterations do
		fn()
	end
	local cpu_elapsed = clock_time(CLOCK_PROCESS_CPUTIME_ID) - cpu_start
	local wall_elapsed = clock_time(CLOCK_MONOTONIC) - wall_start
	local after_memory = collectgarbage("count")
	local per_call_us = wall_elapsed * 1000000 / iterations
	print(
		string.format(
			"%-34s %9d iters %10.3f us/call %8.3f ms wall %8.3f ms cpu %9.0f snap/s dispatch=%d exec=%d mem_delta=%.1f KiB",
			name,
			iterations,
			per_call_us,
			wall_elapsed * 1000,
			cpu_elapsed * 1000,
			iterations / wall_elapsed,
			dispatches,
			execs,
			after_memory - before_memory
		)
	)
end

local function callbacks(name)
	return events[name] or {}
end

local function bench_ultrawide_master(iterations)
	clear_modules()
	reset_events()
	local workspace = make_workspace(3, { monitor = "DP-2", layout = "master", name = "1" })
	current_workspace = workspace
	current_windows = workspace.windows
	for index, window in ipairs(current_windows) do
		window.at = { x = (index - 1) * 500, y = 0 }
		window.size = { x = 500, y = 1400 }
		window.active = index == 1
	end
	active_window = current_windows[1]
	active_monitor = { name = "DP-2" }
	require("layouts.ultrawide_master")
	local layout = layout_providers.ultrawide_master
	local context = { area = { x = 0, y = 0, w = 5120, h = 1440 }, targets = {} }
	for index, window_handle in ipairs(current_windows) do
		context.targets[index] = {
			index = index,
			window = window_handle,
			place = function() end,
		}
	end
	run_case("layouts.ultrawide_master/recalculate-3", iterations, function()
		layout.recalculate(context)
	end)
	run_case("layouts.ultrawide_master/swapnext-3", iterations, function()
		layout.layout_msg(context, "swapnext")
	end)
end

local function make_layout_context(windows)
	local area = { x = 0, y = 0, w = 1440, h = 2560 }
	local targets = {}

	for index, window_handle in ipairs(windows) do
		targets[index] = {
			index = index,
			window = window_handle,
			place = function() end,
		}
	end

	return {
		area = area,
		targets = targets,
		split = function(_, box, side, ratio)
			if side == "top" then
				return { x = box.x, y = box.y, w = box.w, h = box.h * ratio }
			end

			if side == "bottom" then
				return { x = box.x, y = box.y + box.h * (1 - ratio), w = box.w, h = box.h * ratio }
			end
		end,
		row = function(_, index, count)
			return { x = area.x, y = area.y + area.h * (index - 1) / count, w = area.w, h = area.h / count }
		end,
	}
end

local function set_portrait_geometry(windows)
	for index, window in ipairs(windows) do
		window.monitor = { name = "HDMI-A-2" }
		window.stable_id = index
		window.at = { x = 0, y = (index - 1) * 300 }
		window.size = { x = 1440, y = 300 }
	end
end

local function set_active(windows, active_index)
	for index, window in ipairs(windows) do
		window.active = index == active_index
	end
	active_window = windows[active_index]
end

local function bench_portrait_rows(iterations)
	clear_modules()
	reset_events()
	local workspace = make_workspace(3, { monitor = "HDMI-A-2", layout = "dwindle", name = "portrait-3" })
	current_workspace = workspace
	current_windows = workspace.windows
	set_portrait_geometry(current_windows)
	set_active(current_windows, 1)
	active_monitor = { name = "HDMI-A-2" }
	require("layouts.portrait_rows")
	local layout = layout_providers.portrait_rows
	local context = make_layout_context(current_windows)
	run_case("layouts.portrait/recalculate-3", iterations, function()
		layout.recalculate(context)
	end)
	run_case("layouts.portrait/swapnext-3", iterations, function()
		layout.layout_msg(context, "swapnext")
	end)

	local two_window_workspace = make_workspace(2, { monitor = "HDMI-A-2", layout = "dwindle", name = "portrait-2" })
	current_workspace = two_window_workspace
	current_windows = two_window_workspace.windows
	set_portrait_geometry(current_windows)
	set_active(current_windows, 1)
	local two_window_context = make_layout_context(current_windows)
	run_case("layouts.portrait/recalculate-2", iterations, function()
		layout.recalculate(two_window_context)
	end)

	local dragged = current_windows[1]
	run_case("layouts.portrait/drag-reorder-2", iterations, function()
		dragged.at.y = dragged.at.y == 0 and 900 or 0
		layout.recalculate(two_window_context)
	end)
end

local function bench_window_switcher(iterations)
	clear_modules()
	local switcher = require("actions.window-switcher")
	local function set_windows(count)
		local workspace = make_workspace(count, { monitor = "DP-2", layout = "master" })
		current_windows = workspace.windows
		active_window = current_windows[1]
	end

	set_windows(1)
	run_case("window-switcher/1-window", iterations, switcher.next)
	set_windows(50)
	run_case("window-switcher/50-windows", iterations, switcher.next)
end

local function bench_clipboard_bridge(iterations)
	clear_modules()
	local command = require("lib.command")
	command.ok = function()
		return true
	end
	command.output = function(value)
		if value:match("pgrep") then
			return "123 Xwayland :1 -terminate -force-xrandr-emulation\n124 Xwayland :2 -terminate -force-xrandr-emulation"
		end
		if value:match("wl%-paste") then
			return "clipboard text"
		end
		if value:match("xclip %-version") then
			return "xclip version"
		end
		return ""
	end
	current_windows = { make_window(1, { class = "gamescope", initial_class = "gamescope", active = true }) }
	active_window = current_windows[1]
	local bridge = require("actions.clipboard-bridge")
	run_case("clipboard/schedule-gamescope", iterations, bridge.paste_with_clipboard_bridge)
	run_case(
		"clipboard/sync-now-stubbed",
		math.max(100, math.floor(iterations / 10)),
		bridge.sync_wayland_to_xwayland_now
	)
end

local function bench_rule_loader(iterations)
	clear_modules()
	local loader = require("rule_loader")
	run_case("rule-loader/generated phase", math.max(100, math.floor(iterations / 10)), function()
		loader.apply_window_rule_phase(config_dir, "generated")
	end)
end

local function bench_profiles(iterations)
	clear_modules()
	local profiles = require("profiles")
	run_case("profiles/apply", iterations, function()
		profiles.apply("powersave")
	end)
end

local function bench_window_motion(iterations)
	clear_modules()
	local window_directional = require("lib.window.directional")
	local window_state = require("lib.window.state")
	local move_right = window_directional.move("right")
	local move_up = window_directional.move("up")
	local resize_right = window_directional.adjust("resize", "right")
	local normal_window = make_window(1, { workspace = make_workspace(1), active = true })
	normal_window.monitor = { name = "DP-2" }
	normal_window.at = { x = 1440, y = 500 }
	normal_window.size = { x = 1720, y = 1440 }
	local portrait_window = make_window(2, { workspace = make_workspace(1), active = true })
	portrait_window.monitor = { name = "HDMI-A-2" }
	portrait_window.at = { x = 0, y = 0 }
	portrait_window.size = { x = 1440, y = 2560 }

	hl.get_active_window = function()
		return normal_window
	end
	run_case("window.move/right-normal", iterations, move_right)

	hl.get_active_window = function()
		return portrait_window
	end
	run_case("window.move/right-special", iterations, move_right)
	run_case("window.move/up-special", iterations, move_up)
	run_case("window.adjust/resize", iterations, function()
		hl.dispatch(resize_right)
	end)

	local fallback_windows = {}
	for index = 1, 50 do
		fallback_windows[index] = make_window(index, { active = index == 50 })
		fallback_windows[index].monitor = { name = "DP-2" }
	end
	current_windows = fallback_windows
	hl.get_active_window = nil
	run_case("window.active/fallback-50", iterations, function()
		window_state.active()
	end)
end

local function make_capture_fixture(client_count, selector_count)
	local selectors = {
		{
			matcher = "match:class",
			pattern = "^nemo$",
			per_monitor = true,
			exclude = { matcher = "match:initialTitle", patterns = { "^File Operations$", "^Preparing$" } },
		},
		{
			matcher = "match:initialTitle",
			pattern = "^Picture-in-Picture$",
			per_monitor = false,
			persist_tags = { "pip-top-left", "pip-top-right" },
		},
		{ matcher = "match:initialClass", pattern = "^kitty$", per_monitor = true },
		{ matcher = "match:title", pattern = "^Spotify Premium$", per_monitor = true },
	}
	for index = #selectors + 1, selector_count do
		selectors[index] = { matcher = "match:class", pattern = "^unused-" .. index .. "$", per_monitor = true }
	end
	local monitors = {
		{ id = "1", name = "DP-1", x = 0, y = 0 },
		{ id = "2", name = "HDMI-A-1", x = 1920, y = 0 },
		{ id = "3", name = "DP-2", x = -1440, y = 0 },
	}
	local clients = {}
	for index = 1, client_count do
		local monitor = (index - 1) % #monitors + 1
		local monitor_data = monitors[monitor]
		local kind = (index - 1) % 10
		local client = {
			class = "unmatched-app",
			initialClass = "unmatched-app",
			title = "Unmatched",
			floating = true,
			fullscreen = 0,
			fullscreenClient = 0,
			monitor = tostring(monitor),
			at = { monitor_data.x + (index * 37) % 900, monitor_data.y + (index * 23) % 700 },
			size = { 480 + index % 5 * 40, 320 + index % 4 * 30 },
		}
		if kind == 0 then
			client.class = "nemo"
			client.initialClass = "nemo"
			client.initialTitle = "Files"
		elseif kind == 1 then
			client.class = "zen"
			client.initialClass = "zen"
			client.initialTitle = "Picture-in-Picture"
			client.tags = { "pip-top-right*", "pip-top-left*", "unrelated" }
		elseif kind == 2 then
			client.class = "kitty"
			client.initialClass = "kitty"
		elseif kind == 3 then
			client.class = "spotify"
			client.initialClass = "spotify"
			client.title = "Spotify Premium"
		elseif kind == 4 then
			client.class = "nemo"
			client.initialClass = "nemo"
			client.initialTitle = "File Operations"
		elseif kind == 5 then
			client.class = "nemo"
			client.floating = false
		elseif kind == 6 then
			client.class = "kitty"
			client.initialClass = "kitty"
			client.fullscreen = 1
		elseif kind == 7 then
			client.class = "kitty"
			client.initialClass = "kitty"
			client.fullscreenClient = 1
		end
		clients[index] = client
	end

	return selectors, clients, monitors
end

local function bench_window_state_capture(iterations)
	clear_modules()
	local capture = require("runtime.windows.daemons.window-state.capture")
	for _, scenario in ipairs({
		{ name = "realistic-12x4", clients = 12, selectors = 4, iterations = iterations },
		{ name = "selector-heavy-12x32", clients = 12, selectors = 32, iterations = math.max(100, math.floor(iterations / 4)) },
		{ name = "busy-60x4", clients = 60, selectors = 4, iterations = math.max(100, math.floor(iterations / 4)) },
		{ name = "stress-240x4", clients = 240, selectors = 4, iterations = math.max(100, math.floor(iterations / 20)) },
	}) do
		local selectors, clients, monitors = make_capture_fixture(scenario.clients, scenario.selectors)
		run_case(
			"window-state/capture-" .. scenario.name,
			scenario.iterations,
			function()
				capture.snapshot(selectors, clients, monitors)
			end,
			math.min(2000, scenario.iterations)
		)
	end
end

local function bench_transfer_intent(iterations)
	clear_modules()
	local monitor_role = require("lib.monitor_role")
	local intents = require("layouts.shared.intents")
	local stale = { address = "0xstale" }
	local current = { address = "0xcurrent" }
	local target = { window = current }
	local intent = { monitor_role = monitor_role.ultrawide, axis = "x", edge = "start" }

	run_case("order_state/record-stale-replace", iterations, function()
		intents.record_transfer_intent(stale, intent)
		intents.record_transfer_intent(current, intent)
	end)
	run_case("order_state/consume-exact-id", iterations, function()
		intents.record_transfer_intent(current, intent)
		intents.consume_transfer_intent_by_id(target, monitor_role.ultrawide, "x")
	end)
end

local cases = {
	ultrawide_master = bench_ultrawide_master,
	portrait = bench_portrait_rows,
	window_switcher = bench_window_switcher,
	clipboard = bench_clipboard_bridge,
	rule_loader = bench_rule_loader,
	profiles = bench_profiles,
	window_motion = bench_window_motion,
	transfer_intent = bench_transfer_intent,
	window_state_capture = bench_window_state_capture,
}

local selected = arg[1] or "all"
local iterations = tonumber(arg[2]) or default_iterations

if selected == "all" then
	for _, name in ipairs({
		"ultrawide_master",
		"portrait",
		"window_switcher",
		"clipboard",
		"rule_loader",
		"profiles",
		"window_motion",
		"transfer_intent",
		"window_state_capture",
	}) do
		cases[name](iterations)
	end
elseif cases[selected] then
	cases[selected](iterations)
else
	print(
		"usage: lua "
			.. script_path
			.. " [all|ultrawide_master|portrait|window_switcher|clipboard|rule_loader|profiles|window_motion|transfer_intent|window_state_capture] [iterations]"
	)
	os.exit(2)
end
