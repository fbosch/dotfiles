local script_path = arg[0] or ""
local config_dir = script_path:match("^(.*)/benchmarks/hotpaths%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local default_iterations = tonumber(os.getenv("HYPR_BENCH_ITERATIONS") or "10000") or 10000
local dispatches = 0
local execs = 0
local current_windows = {}
local current_workspace = nil
local active_window = nil
local active_monitor = { name = "DP-2" }
local events = {}

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
end

local function make_window(index, opts)
	opts = opts or {}
	return {
		address = "0x" .. tostring(index),
		active = opts.active or false,
		class = opts.class or "kitty",
		initial_class = opts.initial_class or opts.class or "kitty",
		floating = opts.floating or false,
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
		windows[index] = make_window(index, { workspace = workspace, floating = opts.floating or false })
	end

	function workspace:get_windows()
		return windows
	end

	workspace.windows = windows
	return workspace
end

hl = {
	dsp = {
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
	window_rule = function()
		dispatches = dispatches + 1
	end,
	config = function()
		dispatches = dispatches + 1
	end,
}

local function run_case(name, iterations, fn)
	collectgarbage("collect")
	reset_counters()
	local before_memory = collectgarbage("count")
	local start = os.clock()
	for _ = 1, iterations do
		fn()
	end
	local elapsed = os.clock() - start
	local after_memory = collectgarbage("count")
	local per_call_us = elapsed * 1000000 / iterations
	print(string.format(
		"%-34s %9d iters %10.3f us/call %8.3f ms total dispatch=%d exec=%d mem_delta=%.1f KiB",
		name,
		iterations,
		per_call_us,
		elapsed * 1000,
		dispatches,
		execs,
		after_memory - before_memory
	))
end

local function callbacks(name)
	return events[name] or {}
end

local function bench_dp2_master(iterations)
	clear_modules()
	reset_events()
	local workspace = make_workspace(3, { monitor = "DP-2", layout = "master", name = "1" })
	current_workspace = workspace
	current_windows = workspace.windows
	active_window = current_windows[1]
	active_monitor = { name = "DP-2" }
	require("layouts.dp2_master")
	local callback = callbacks("window.open")[1]
	run_case("layouts.dp2_master/window.open", iterations, function()
		callback(current_windows[1])
	end)
end

local function bench_portrait_dwindle(iterations)
	clear_modules()
	reset_events()
	local workspace = make_workspace(3, { monitor = "HDMI-A-2", layout = "dwindle", name = "2" })
	current_workspace = workspace
	current_windows = workspace.windows
	active_window = current_windows[1]
	active_monitor = { name = "HDMI-A-2" }
	require("layouts.portrait_dwindle")
	local callback = callbacks("window.open")[1]
	run_case("layouts.portrait/window.open", iterations, function()
		callback(current_windows[3])
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
	run_case("clipboard/sync-now-stubbed", math.max(100, math.floor(iterations / 10)), bridge.sync_wayland_to_xwayland_now)
end

local function bench_rule_loader(iterations)
	clear_modules()
	local loader = require("rule-loader")
	run_case("rule-loader/generated phase", math.max(100, math.floor(iterations / 10)), function()
		loader.apply_window_rule_phase(config_dir, "generated")
	end)
end

local function bench_profiles(iterations)
	clear_modules()
	local command = require("lib.command")
	command.ok = function()
		return true
	end
	local profiles = require("profiles")
	run_case("profiles/is_active-stubbed", iterations, function()
		profiles.is_active("performance")
	end)
	run_case("profiles/apply", iterations, function()
		profiles.apply("performance")
	end)
end

local function bench_window_motion(iterations)
	clear_modules()
	local window = require("lib.window")
	local move_right = window.move("right")
	local move_up = window.move("up")
	local resize_right = window.adjust("resize", "right")
	local normal_window = make_window(1, { workspace = make_workspace(1), active = true })
	normal_window.monitor = { name = "DP-2" }
	local portrait_window = make_window(2, { workspace = make_workspace(1), active = true })
	portrait_window.monitor = { name = "HDMI-A-2" }

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
		window.active()
	end)
end

local cases = {
	dp2_master = bench_dp2_master,
	portrait = bench_portrait_dwindle,
	window_switcher = bench_window_switcher,
	clipboard = bench_clipboard_bridge,
	rule_loader = bench_rule_loader,
	profiles = bench_profiles,
	window_motion = bench_window_motion,
}

local selected = arg[1] or "all"
local iterations = tonumber(arg[2]) or default_iterations

if selected == "all" then
	for _, name in ipairs({ "dp2_master", "portrait", "window_switcher", "clipboard", "rule_loader", "profiles", "window_motion" }) do
		cases[name](iterations)
	end
elseif cases[selected] then
	cases[selected](iterations)
else
	print("usage: lua " .. script_path .. " [all|dp2_master|portrait|window_switcher|clipboard|rule_loader|profiles|window_motion] [iterations]")
	os.exit(2)
end
