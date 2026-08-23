#!/usr/bin/env luajit

local socket = require("socket")
local unix = require("socket.unix")
local ffi = require("ffi")

ffi.cdef([[typedef int pid_t;
pid_t fork(void);
pid_t waitpid(pid_t pid, int *status, int options);
]])

local repo_root = assert(os.getenv("REPO_ROOT"), "REPO_ROOT is required")
local test_dir = os.getenv("TEST_DIR")
if not test_dir then
	test_dir = (os.getenv("TMPDIR") or "/tmp")
		.. "/window-state-fixture-"
		.. tostring(math.floor(socket.gettime() * 1000000))
end
local home_dir = test_dir .. "/home"
local runtime_dir = test_dir .. "/runtime"
local bin_dir = test_dir .. "/bin"
local hypr_dir = runtime_dir .. "/hypr/fixture"
local query_path = hypr_dir .. "/.socket.sock"
local event_path = hypr_dir .. "/.socket2.sock"
local state_path = hypr_dir .. "/window-state.cache"
local rules_path = home_dir .. "/.config/hypr/rules/window-state.lua"
local log_path = test_dir .. "/daemon.log"
local hyprctl_log_path = test_dir .. "/hyprctl.log"
local pid_path = test_dir .. "/daemon.pid"
local reader_log_path = test_dir .. "/reader.log"
local reader_stop_path = test_dir .. "/reader.stop"
local reader_report_path = test_dir .. "/reader.report"

local query_server
local event_server
local daemon_pid
local reader_pid
local active_event_connections = 0
local event_closed_at
local reconnect_at
local first_query_done = false
local initial_published = false
local reconnected = false

local initial_clients = [=[[{"class":"nemo","floating":true,"monitor":1,"at":[110,220],"size":[800,600]}]]=]
local updated_clients = [=[
	[
	  {"class":"Bitwarden","floating":true,"monitor":1,"at":[130,240],"size":[1000,700]},
	  {"class":"app.zen_browser.zen","initialTitle":"Picture-in-Picture","tags":["pip-top-left"],"floating":true,"monitor":1,"at":[15,15],"size":[500,300]},
	  {"class":"nemo","floating":true,"monitor":1,"at":[150,260],"size":[900,650]},
  {"class":"nemo","initialTitle":"File Operations","floating":true,"monitor":1,"at":[250,360],"size":[300,200]},
  {"class":"nemo","initialTitle":"Preparing","floating":true,"monitor":1,"at":[350,460],"size":[320,220]},
  {"class":"Mullvad VPN","floating":true,"fullscreen":1,"fullscreenClient":1,"monitor":1,"at":[0,0],"size":[1920,1080]},
  {"class":"nemo","floating":true,"monitor":2,"at":[1030,140],"size":[500,600]}
]
]=]
local monitors = [=[
[
  {"id":1,"name":"DP-1","x":0,"y":0},
  {"id":2,"name":"HDMI-A-1","x":1000,"y":100}
]
]=]

local function shell_quote(value)
	return "'" .. value:gsub("'", "'\\''") .. "'"
end

local function run(command)
	local status = os.execute(command)
	assert(status == 0, "command failed: " .. command)
end

local function fail(phase, message)
	local handle = io.open(log_path, "r")
	local diagnostic = handle and handle:read("*a")
	if handle then
		handle:close()
	end
	error("[" .. phase .. "] " .. message .. (diagnostic and "\ndaemon log:\n" .. diagnostic or ""), 0)
end

local function read_file(path)
	local handle = io.open(path, "r")
	if not handle then
		return nil
	end
	local content = handle:read("*a")
	handle:close()
	return content
end

local function write_file(path, content)
	local handle = assert(io.open(path, "w"))
	handle:write(content)
	handle:close()
end

local function generated_rule(monitor, pattern)
	local content = read_file(rules_path)
	if not content then
		return nil
	end

	local chunk = loadstring(content, "window-state.lua")
	if not chunk then
		return nil
	end

	for _, rule in ipairs(chunk()) do
		if rule.monitor == monitor and rule.pattern == pattern then
			return rule
		end
	end

	return nil
end

local function validate_reader_state()
	local json = require("lib.json")
	local state = read_file(state_path)
	if state then
		local ok, decoded = pcall(json.decode, state:gsub("%s+$", ""))
		assert(ok and type(decoded) == "table", "runtime cache is not valid JSON")
	end

	local rules = read_file(rules_path)
	if rules then
		local chunk, load_error = loadstring(rules, "window-state.lua")
		assert(chunk, "generated rules are not valid Lua: " .. tostring(load_error))
		local ok, decoded = pcall(chunk)
		assert(ok and type(decoded) == "table", "generated rules do not return a table")
	end
end

local function reader_fixture()
	package.path = home_dir .. "/.config/hypr/?.lua;" .. home_dir .. "/.config/hypr/?/init.lua;" .. package.path
	local iterations = 0
	local deadline = socket.gettime() + 12
	while not read_file(reader_stop_path) and socket.gettime() < deadline do
		validate_reader_state()
		iterations = iterations + 1
		socket.sleep(0.005)
	end
	assert(read_file(reader_stop_path), "reader exceeded its bounded lifetime")
	assert(iterations > 0, "reader did not validate any publication")
	local report = assert(io.open(reader_report_path, "w"))
	report:write(tostring(iterations), "\n")
	report:close()
end

local function wait_for(phase, predicate, timeout)
	local deadline = socket.gettime() + timeout
	while socket.gettime() < deadline do
		if predicate() then
			return
		end
		socket.sleep(0.02)
	end
	fail(phase, "timed out after " .. timeout .. "s")
end

local function accept_query()
	local client = query_server:accept()
	if not client then
		return
	end
	client:settimeout(0.2)
	local request, _, partial = client:receive("*a")
	request = request or partial or ""
	if request:find("j/monitors", 1, true) then
		assert(client:send(monitors))
	elseif request:find("j/clients", 1, true) then
		first_query_done = true
		assert(client:send(initial_published and updated_clients or initial_clients))
		initial_published = true
	end
	client:close()
end

local function accept_event()
	local client = event_server:accept()
	if not client then
		return
	end
	active_event_connections = active_event_connections + 1
	if active_event_connections == 2 then
		event_closed_at = socket.gettime()
		client:close()
		return
	end
	if active_event_connections == 3 then
		reconnect_at = socket.gettime()
		reconnected = true
		assert(client:send("closewindow>>fixture\n"))
		client:close()
		return
	end
	client:close()
end

local function service_until(phase, predicate, timeout)
	local deadline = socket.gettime() + timeout
	while socket.gettime() < deadline do
		local ready = socket.select({ query_server, event_server }, nil, 0.05)
		for _, server in ipairs(ready) do
			if server == query_server then
				accept_query()
			else
				accept_event()
			end
		end
		if predicate() then
			return
		end
	end
	fail(
		phase,
		"timed out after "
			.. timeout
			.. "s (first_query="
			.. tostring(first_query_done)
			.. ", state="
			.. tostring(read_file(state_path))
			.. ")"
	)
end

local function assert_contains(phase, content, expected)
	if not content or not content:find(expected, 1, true) then
		fail(phase, "missing " .. expected)
	end
end

local function stop_daemon()
	if not daemon_pid then
		return
	end
	os.execute("kill -TERM " .. daemon_pid .. " 2>/dev/null")
	wait_for("child cleanup", function()
		return os.execute("kill -0 " .. daemon_pid .. " 2>/dev/null") ~= 0
	end, 1)
	daemon_pid = nil
end

local function stop_reader()
	if not reader_pid then
		return
	end
	if read_file(reader_report_path) then
		reader_pid = nil
		return
	end
	run("touch " .. shell_quote(reader_stop_path))
	local status = ffi.new("int[1]")
	wait_for("reader cleanup", function()
		return read_file(reader_report_path) ~= nil or ffi.C.waitpid(reader_pid, status, 1) == reader_pid
	end, 1)
	local log = read_file(reader_log_path)
	local report = read_file(reader_report_path)
	reader_pid = nil
	if log and log ~= "" then
		fail("concurrent reader", log)
	end
	if not report or tonumber(report:match("%d+")) < 1 then
		fail("concurrent reader", "reader did not complete any validation\n" .. (log or "reader log unavailable"))
	end
end

local function start_reader()
	local pid = ffi.C.fork()
	assert(pid >= 0, "failed to fork concurrent reader")
	if pid == 0 then
		local handle = assert(io.open(reader_log_path, "w"))
		io.stderr = handle
		local ok, message = xpcall(reader_fixture, debug.traceback)
		if not ok then
			handle:write(message, "\n")
			handle:close()
			os.exit(1)
		end
		handle:close()
		os.exit(0)
	end
	reader_pid = pid
end

local function cleanup()
	if daemon_pid then
		os.execute("kill -KILL " .. daemon_pid .. " 2>/dev/null")
	end
	if query_server then
		query_server:close()
	end
	if event_server then
		event_server:close()
	end
	stop_reader()
	os.execute("rm -rf " .. shell_quote(test_dir))
end

local function fixture()
	run(
		"mkdir -p "
			.. shell_quote(home_dir .. "/.config/hypr")
			.. " "
			.. shell_quote(runtime_dir)
			.. " "
			.. shell_quote(bin_dir)
			.. " "
			.. shell_quote(hypr_dir)
	)
	run(
		"cp -R "
			.. shell_quote(repo_root .. "/.config/hypr/runtime")
			.. " "
			.. shell_quote(home_dir .. "/.config/hypr/")
			.. " && cp -R "
			.. shell_quote(repo_root .. "/.config/hypr/lib")
			.. " "
			.. shell_quote(home_dir .. "/.config/hypr/")
			.. " && cp -R "
			.. shell_quote(repo_root .. "/.config/hypr/rules")
			.. " "
			.. shell_quote(home_dir .. "/.config/hypr/")
	)
	write_file(
		rules_path,
		[[return {
  {
    id = "window-state:match:class:^nemo$",
    matcher = "match:class",
    pattern = "^nemo$",
    match = { class = "^nemo$" },
    effects = {
      monitor = "DP-1",
      size = "800 600",
      move = "110 220",
    },
  },
}
]]
	)
	run(
		"printf '%s\\n' '#!/bin/sh' 'printf '''%s\\n''' \"$*\" >> \"$HYPRCTL_LOG_PATH\"' 'exit 0' > "
			.. shell_quote(bin_dir .. "/hyprctl")
			.. " && chmod +x "
			.. shell_quote(bin_dir .. "/hyprctl")
	)

	query_server = assert(unix())
	assert(query_server:bind(query_path))
	assert(query_server:listen(8))
	query_server:settimeout(0)
	event_server = assert(unix())
	assert(event_server:bind(event_path))
	assert(event_server:listen(8))
	event_server:settimeout(0)

	local daemon = home_dir .. "/.config/hypr/runtime/windows/daemons/window-state/window-state.sh"
	local command = "HOME="
		.. shell_quote(home_dir)
		.. " XDG_RUNTIME_DIR="
		.. shell_quote(runtime_dir)
		.. " HYPRLAND_INSTANCE_SIGNATURE=fixture WINDOW_STATE_IDLE_SCHED=1"
		.. " HYPRCTL_LOG_PATH="
		.. shell_quote(hyprctl_log_path)
		.. " PATH="
		.. shell_quote(bin_dir .. ":" .. os.getenv("PATH"))
		.. " "
		.. shell_quote(daemon)
		.. " >"
		.. shell_quote(log_path)
		.. " 2>&1 & printf '%s' $! >"
		.. shell_quote(pid_path)
	run(command)
	daemon_pid = assert(read_file(pid_path)):match("%d+")
	start_reader()

	service_until("initial query/state publication", function()
		local state = read_file(state_path)
		return first_query_done and not reconnected and state and state:find('"width":800', 1, true) ~= nil
	end, 3)

	service_until("event socket closure", function()
		return event_closed_at ~= nil
	end, 2)
	service_until("event reconnect after one-second delay", function()
		return reconnect_at ~= nil
	end, 3)
	if reconnect_at - event_closed_at < 0.9 then
		fail("event reconnect after one-second delay", "reconnected too early")
	end

	service_until("post-reconnect event processing", function()
		local state = read_file(state_path)
		local rules = read_file(rules_path)
		return state
			and state:find('"Bitwarden"', 1, true)
			and not state:find('"Mullvad VPN"', 1, true)
			and not state:find('"width":300', 1, true)
			and not state:find('"width":320', 1, true)
			and rules
			and rules:find("Bitwarden", 1, true)
			and rules:find("nemo", 1, true)
			and rules:find('workspace = "m[DP-1]"', 1, true)
			and rules:find('workspace = "m[HDMI-A-1]"', 1, true)
			and generated_rule("DP-1", "^nemo$")
			and generated_rule("DP-1", "^nemo$").effects.fullscreen_state == "0 0"
			and generated_rule("DP-1", "^nemo$").effects.move == "150 260"
			and generated_rule("HDMI-A-1", "^nemo$")
			and generated_rule("HDMI-A-1", "^nemo$").match.workspace == "m[HDMI-A-1]"
			and generated_rule("DP-1", "^nemo$").match.initial_title == "negative:(^File Operations$|^Preparing$)"
			and generated_rule("HDMI-A-1", "^nemo$").effects.move == "30 40"
			and generated_rule(nil, "^Picture-in-Picture$")
			and generated_rule(nil, "^Picture-in-Picture$").tags[1] == "pip-top-left"
			and generated_rule(nil, "^Picture-in-Picture$").match.workspace == nil
			and rules:find('animation = "slide left"', 1, true)
	end, 3)
	local log = read_file(log_path)
	assert_contains("daemon reconnect log", log, "window-state: event socket reconnected")
	assert_contains("window-state rule refresh", read_file(hyprctl_log_path), "reload config-only")
	stop_daemon()
	stop_reader()
end

local ok, message = xpcall(fixture, debug.traceback)
cleanup()
if not ok then
	io.stderr:write(message, "\n")
	os.exit(1)
end
print("PASS window-state daemon query, reconnect, and cache publication")
