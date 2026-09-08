local script_path = debug.getinfo(1, "S").source:sub(2)
local config_dir = script_path:match("^(.*)/tests/waybar_workers_spec%.lua$") or ".config/hypr"
package.path = config_dir .. "/?.lua;" .. config_dir .. "/?/init.lua;" .. package.path

local socket = require("socket")
local workers = require("runtime.desktop.waybar-workers")

local function reap_with_timeout(worker)
	local deadline = socket.gettime() + 1
	while socket.gettime() < deadline do
		local finished, succeeded = workers.reap(worker)
		if finished then
			return succeeded
		end
		socket.sleep(0.005)
	end
	error("worker did not exit")
end

local function process_state(pid)
	local handle = io.open("/proc/" .. pid .. "/stat", "r")
	if not handle then
		return nil
	end
	local state = handle:read("*a"):match("%) (%a)")
	handle:close()
	return state
end

describe("Waybar workers", function()
	it("returns worker results without losing metadata", function()
		local worker = assert(workers.start("success", function()
			return true
		end, { generation = 7 }))

		assert.is_true(reap_with_timeout(worker))
		assert.are.equal(7, worker.metadata.generation)
	end)

	it("retires descendants when the worker leader completes", function()
		local pid_file = os.tmpname()
		local worker = assert(workers.start("orphan", function()
			return os.execute("sh -c 'sleep 5' & echo $! > " .. pid_file) == 0
		end))

		assert.is_true(reap_with_timeout(worker))
		local handle = assert(io.open(pid_file, "r"))
		local pid = assert(handle:read("*l"))
		handle:close()
		os.remove(pid_file)

		local deadline = socket.gettime() + 0.5
		local state = process_state(pid)
		while state ~= nil and state ~= "Z" and socket.gettime() < deadline do
			socket.sleep(0.005)
			state = process_state(pid)
		end
		assert(state == nil or state == "Z", "worker descendant is still running")
	end)

	it("terminates the complete worker process group", function()
		local worker = assert(workers.start("blocked", function()
			return os.execute("sleep 5") == 0
		end))
		socket.sleep(0.05)

		assert.is_true(workers.terminate(worker))
		assert.is_false(workers.wait(worker))
	end)
end)
