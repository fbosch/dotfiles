local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/hypr_ipc_spec%.lua$") or ".config/hypr"

package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local function assert_equal(actual, expected, message)
	if actual ~= expected then
		error(string.format("%s: expected %s, got %s", message, tostring(expected), tostring(actual)), 2)
	end
end

local function with_environment(environment, callback)
	local original_getenv = os.getenv
	os.getenv = function(name)
		return environment[name]
	end
	package.loaded["runtime.lib.hypr-ipc"] = nil

	local ok, err = pcall(function()
		callback(require("runtime.lib.hypr-ipc"))
	end)
	os.getenv = original_getenv
	package.loaded["runtime.lib.hypr-ipc"] = nil
	if ok == false then
		error(err, 0)
	end
end

it("derives daemon paths from the active Hyprland instance", function()
	with_environment({
		XDG_RUNTIME_DIR = "/run/user/1000",
		HYPRLAND_INSTANCE_SIGNATURE = "instance-a",
	}, function(hypr_ipc)
		assert_equal(hypr_ipc.instance_runtime_dir(), "/run/user/1000/hypr/instance-a", "instance runtime directory")
		assert_equal(
			hypr_ipc.instance_path("daemon/command.sock"),
			"/run/user/1000/hypr/instance-a/daemon/command.sock",
			"daemon path"
		)
		assert_equal(
			hypr_ipc.instance_socket_path("daemon.sock"),
			"/run/user/1000/hypr/instance-a/daemon.sock",
			"daemon socket path"
		)
		assert_equal(
			hypr_ipc.socket_path(".socket.sock"),
			"/run/user/1000/hypr/instance-a/.socket.sock",
			"Hyprland socket path"
		)
	end)
end)

it("rejects Unix socket paths that exceed the platform limit", function()
	with_environment({
		XDG_RUNTIME_DIR = "/run/user/1000",
		HYPRLAND_INSTANCE_SIGNATURE = "instance-a",
	}, function(hypr_ipc)
		assert_equal(pcall(hypr_ipc.instance_socket_path, string.rep("x", 108)), false, "long socket path")
	end)
end)
